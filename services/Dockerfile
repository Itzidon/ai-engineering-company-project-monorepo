FROM python:3.12-slim
WORKDIR /app

COPY services/requirements.txt requirements.txt

RUN pip install --no-cache-dir uv
RUN uv pip install --system -r requirements.txt

COPY . /app

CMD ["uvicorn", "services.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
