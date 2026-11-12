from decimal import Decimal


def detect_price_variance(current_cost, baseline_cost, threshold=10):
    current = Decimal(str(current_cost))
    baseline = Decimal(str(baseline_cost))
    limit = Decimal(str(threshold))

    if current < 0 or baseline <= 0 or limit < 0:
        raise ValueError("Invalid price or threshold")

    variance = (current - baseline) / baseline * 100
    detected = abs(variance) > limit

    return float(variance), detected
