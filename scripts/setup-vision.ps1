$ErrorActionPreference = 'Stop'

'---- installing python vision dependencies ----'
python -m pip install --disable-pip-version-check numpy opencv-python-headless rapidocr-onnxruntime

'---- verify ----'
python -c "import cv2, numpy; print('opencv', cv2.__version__)"
python -c "from rapidocr_onnxruntime import RapidOCR; print('rapidocr ok')"
