import { expect, test } from "@playwright/test";

const baseURL = process.env.UI_URL ?? "http://127.0.0.1:3011";

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(viewport.name, () => {
    test.use({ baseURL, viewport });

    test("controlled inventory capture reaches the real telemetry endpoint", async ({ page }) => {
      test.setTimeout(60000);
      const received: { event_type: string; properties: Record<string, unknown> }[] = [];
      const statuses: number[] = [];
      const errors: string[] = [];
      let stock = 10;
      let orderId = 200;
      const product = {
        id: 3, name: "Controlled ingredient", sku: "CONTROL-3", unit: "kg",
        category: "meat", country: "CO", current_stock: stock,
      };

      await page.addInitScript(() => localStorage.setItem("brasaland_token", "controlled-not-a-real-token"));
      await page.route("**/inventory/**", async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        let body: unknown;
        let status = 200;
        if (path === "/inventory/orders/inbound") {
          body = {
            ...request.postDataJSON(), id: 101, supplier_key: "a".repeat(64),
            baseline_unit_cost: 100, variance_pct: 20,
          };
          status = 201;
        } else if (path === "/inventory/orders/outbound") {
          const data = request.postDataJSON();
          const previous = stock;
          stock -= data.quantity;
          body = { ...data, id: ++orderId, previous_stock: previous, current_stock: stock };
          status = 201;
        } else if (path.endsWith("/stock")) {
          body = { product_id: 3, location_id: 1, country: "CO", unit: "kg", current_stock: stock };
        } else {
          body = path === "/inventory/products" ? [{ ...product, current_stock: stock }] : { ...product, current_stock: stock };
        }
        await route.fulfill({ status, json: body });
      });
      page.on("pageerror", error => errors.push(error.message));
      page.on("response", response => {
        if (new URL(response.url()).pathname !== "/telemetry/events") return;
        statuses.push(response.status());
        received.push(...response.request().postDataJSON().events);
      });

      await page.goto("/backoffice/inventory/orders/inbound");
      await page.getByLabel("Ingrediente", { exact: true }).selectOption("3");
      await page.getByLabel("Cantidad recibida").fill("2");
      await page.getByLabel("Nombre del proveedor").fill("private-supplier@example.com");
      await page.getByLabel("Precio unitario", { exact: false }).fill("120");
      await page.getByRole("button", { name: "Registrar entrega", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("Entrega registrada correctamente.");
      await expect.poll(() => received.map(event => event.event_type), { timeout: 15000 })
        .toContain("ingredient_price_variance_detected");

      await page.getByRole("link", { name: "Volver al inventario" }).click();
      await page.getByRole("link", { name: "+ Registrar salida" }).click();
      await page.getByLabel("Ingrediente", { exact: true }).selectOption("3");
      await page.getByLabel("Cantidad a retirar").fill("2");
      await page.getByRole("button", { name: "Registrar salida", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("Salida registrada correctamente.");
      await expect(page.getByText("8 kg", { exact: true })).toBeVisible();
      await page.getByLabel("Motivo", { exact: true }).selectOption("waste");
      await page.getByLabel("Causa de la merma").selectOption("kitchen_error");
      await page.getByLabel("Cantidad a retirar").fill("1");
      await page.getByRole("button", { name: "Registrar salida", exact: true }).click();
      await expect(page.getByText("7 kg", { exact: true })).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "private-error@example.com" })));
      await expect.poll(() => received.map(event => event.event_type), { timeout: 15000 })
        .toContain("frontend_error_captured");

      const names = received.map(event => event.event_type);
      for (const required of ["inbound_order_created", "outbound_order_created", "stock_waste_registered", "stock_threshold_triggered", "page_load_recorded"]) {
        expect(names).toContain(required);
      }
      expect(received.filter(event => event.event_type === "stock_threshold_triggered")).toHaveLength(1);
      expect(received.find(event => event.event_type === "stock_threshold_triggered")?.properties.quantity).toBe(8);
      expect(received.find(event => event.event_type === "stock_waste_registered")?.properties.reason).toBe("kitchen_error");
      expect(statuses.every(status => status === 200)).toBe(true);
      expect(JSON.stringify(received)).not.toMatch(/private-|controlled-not-a-real-token/);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/brasaland-telemetry-${viewport.name}.png`, fullPage: true });
    });
  });
}