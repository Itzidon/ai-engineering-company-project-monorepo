FROM node:24-alpine
WORKDIR /app

COPY uis/website/package*.json /app/uis/website/
COPY uis/backoffice/package*.json /app/uis/backoffice/

RUN cd /app/uis/website && npm install --no-audit --no-fund
RUN cd /app/uis/backoffice && npm install --no-audit --no-fund

COPY . /app

CMD ["sh", "/app/uis/start.sh"]
