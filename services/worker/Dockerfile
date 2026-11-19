# Imagem do worker. Dois modos:
#   padrão (RECONSTRUCTOR=mock): só o contrato HTTP, devolve o template. Sem GPU e sem modelos.
#   --build-arg FLAME=1 (RECONSTRUCTOR=flame): reconstrução por ajuste do FLAME em CPU. Os modelos têm licença
#   própria e NÃO entram na imagem: monte uma pasta em /models com
#     /models/flame/flame2023_Open.pkl, /models/flame/FLAME_masks.pkl, /models/flame/mediapipe_landmark_embedding.npz
#     /models/face_landmarker.task
#   (NÃO TESTADO: esta imagem nunca foi construída nesta máquina; as bibliotecas de sistema abaixo são o palpite
#   usual do OpenCV/MediaPipe em python:slim.)
# A imagem com CUDA + VGGTFace é uma evolução futura (exige licença; ver docs/ETAPA-6-ROSTO-REAL.md).
FROM python:3.12-slim
ARG FLAME=0
WORKDIR /app
RUN useradd --create-home worker
COPY requirements.txt requirements-face.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && if [ "$FLAME" = "1" ]; then \
         apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
         && rm -rf /var/lib/apt/lists/* \
         && pip install --no-cache-dir -r requirements-face.txt; \
       fi
COPY app ./app
COPY assets/template-head.glb ./assets/template-head.glb
USER worker
ENV RECONSTRUCTOR=mock \
    FLAME_DIR=/models/flame \
    LANDMARKER_MODEL=/models/face_landmarker.task
EXPOSE 8000
CMD ["uvicorn", "app.main:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000"]
