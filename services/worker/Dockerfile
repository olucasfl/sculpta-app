# Imagem do worker em modo mock (sem GPU). A imagem com CUDA + VGGTFace entra na Fase 4 real:
# trocar a base por nvidia/cuda + PyTorch, baixar pesos no build e usar RECONSTRUCTOR=vggtface.
FROM python:3.12-slim
WORKDIR /app
RUN useradd --create-home worker
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY assets ./assets
USER worker
ENV RECONSTRUCTOR=mock
EXPOSE 8000
CMD ["uvicorn", "app.main:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000"]
