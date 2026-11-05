$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$hub = 'https://mirrors.huaweicloud.com/repository/pypi/simple/'

'---- installing voice dependencies (edge-tts + whisper + playback) ----'
python -m pip install --disable-pip-version-check edge-tts faster-whisper playsound3

'---- verify main-env imports ----'
python -c "import edge_tts; print('edge-tts ok')"
python -c "import faster_whisper; print('faster-whisper ok')"
python -c "import playsound3; print('playsound3 ok')"

'---- GPT-SoVITS (voice cloning) in an isolated Python 3.11 venv ----'
$gsSrc = Join-Path $projectRoot 'vendor\gptsovits-src\GPT-SoVITS-main'
$gsVenv = Join-Path $projectRoot 'vendor\gptsovits-venv'
$gsModel = Join-Path $projectRoot 'vendor\GPT-SoVITS-models'

if (-not (Test-Path (Join-Path $gsSrc 'GPT_SoVITS'))) {
    'downloading GPT-SoVITS source...'
    $zip = Join-Path $projectRoot 'vendor\gptsovits-src.zip'
    Invoke-WebRequest -Uri 'https://github.com/RVC-Boss/GPT-SoVITS/archive/refs/heads/main.zip' -OutFile $zip -TimeoutSec 180
    Expand-Archive -Path $zip -DestinationPath (Join-Path $projectRoot 'vendor\gptsovits-src') -Force
    Remove-Item $zip -Force
}

if (-not (Test-Path (Join-Path $gsVenv 'Scripts\python.exe'))) {
    'creating GPT-SoVITS venv (Python 3.11)...'
    uv python install 3.11
    uv venv --python 3.11 $gsVenv
}
$gsPy = Join-Path $gsVenv 'Scripts\python.exe'

if (-not (Test-Path (Join-Path $gsVenv 'Lib\site-packages\gptsovits_ready.flag'))) {
    'installing GPT-SoVITS python deps (CPU torch 2.6)...'
    uv pip install --python $gsPy --index-url $hub --no-deps torch==2.6.0 torchaudio==2.6.0
    uv pip install --python $gsPy --index-url $hub --no-deps numpy==1.26.4 transformers==4.51.3 huggingface-hub==0.31.0 tokenizers==0.21.1
    uv pip install --python $gsPy --index-url $hub --no-deps librosa==0.10.2 lazy_loader pooch soxr numba==0.60 llvmlite==0.43 soundfile cffi pycparser sentencepiece cn2an proces pypinyin g2p_en jieba==0.42.1 peft==0.13.2 tqdm psutil chardet PyYAML pydantic==2.10.6 pydantic_core==2.27.2 annotated_types scipy==1.11.4 x_transformers==2.11.24 torchmetrics==1.5.1 rotary_embedding_torch ctranslate2==4.5.0 av==13.1.0 ffmpeg-python future==1.0.0 opencc==1.1.8 onnxruntime==1.18.0 onnx==1.16.0
    uv pip install --python $gsPy --index-url $hub --no-deps pytorch-lightning==2.4.0 lightning_utilities==0.11.2 rich setuptools==75.3.0 mpmath sympy matplotlib cycler fonttools kiwisolver contourpy pyparsing python-dateutil six joblib decorator msgpack einops einx frozendict accelerate loguru win32_setctime resampy split_lang budoux
    & $gsPy -c "import torch, transformers, librosa, cn2an, pypinyin, peft, opencc, onnxruntime, pytorch_lightning; print('gptsovits deps ok')"
    New-Item -ItemType File -Path (Join-Path $gsVenv 'Lib\site-packages\gptsovits_ready.flag') | Out-Null
}

'---- GPT-SoVITS models (~1.5GB total) via huggingface_hub with mirror ----'
$env:HF_ENDPOINT = 'https://hf-mirror.com'
if (-not (Test-Path (Join-Path $gsModel 'gsv-v2final-pretrained'))) {
    & $gsPy -c "
from huggingface_hub import snapshot_download
snapshot_download('lj1995/GPT-SoVITS', local_dir=r'$gsModel', allow_patterns=['chinese-hubert-base/*','chinese-roberta-wwm-ext-large/*','gsv-v2final-pretrained/*'])
"
}
if (-not (Test-Path (Join-Path $gsSrc 'GPT_SoVITS\text\G2PWModel\g2pW.onnx'))) {
    'downloading G2PW polyphonic model (~588MB)...'
    $g2pw = Join-Path $projectRoot 'vendor\tmp-dl\G2PWModel.zip'
    Invoke-WebRequest -Uri 'https://huggingface.co/XXXXRT/GPT-SoVITS-Pretrained/resolve/main/G2PWModel.zip' -OutFile $g2pw -TimeoutSec 300
    Expand-Archive -Path $g2pw -DestinationPath (Join-Path $projectRoot 'vendor\tmp-dl\G2PW-extract') -Force
    Copy-Item (Join-Path $projectRoot 'vendor\tmp-dl\G2PW-extract\G2PWModel') (Join-Path $gsSrc 'GPT_SoVITS\text\G2PWModel') -Recurse -Force
}

'---- GPT-SoVITS jieba_fast shim (no py3.11 wheel) ----'
$shimDir = Join-Path $gsVenv 'Lib\site-packages\jieba_fast'
if (-not (Test-Path (Join-Path $shimDir '__init__.py'))) {
    New-Item -ItemType Directory -Force -Path (Join-Path $shimDir 'posseg') | Out-Null
    @'
import sys as _sys
import jieba as _jieba
cut = _jieba.cut
lcut = _jieba.lcut
cut_for_search = _jieba.cut_for_search
lcut_for_search = _jieba.lcut_for_search
tokenize = _jieba.tokenize
set_dictionary = _jieba.set_dictionary
initialize = _jieba.initialize
get_DAG = _jieba.get_DAG
calc = _jieba.calc
from . import posseg  # noqa: E402,F401
for _name in dir(_jieba):
    if _name.startswith('__'):
        continue
    if not hasattr(_sys.modules[__name__], _name):
        setattr(_sys.modules[__name__], _name, getattr(_jieba, _name))
'@ | Set-Content -LiteralPath (Join-Path $shimDir '__init__.py') -Encoding utf8
    @'
from jieba.posseg import *  # noqa: F401,F403
from jieba.posseg import POSTokenizer, pair  # noqa: F401
'@ | Set-Content -LiteralPath (Join-Path $shimDir 'posseg\__init__.py') -Encoding utf8
}

'---- verify gptsovits import (jieba_fast shim) ----'
& $gsPy -c "import jieba_fast; print('jieba_fast shim ok')"

'---- verify clone synthesis path ----'
& $gsPy -c "import sys; sys.path.insert(0, r'$gsSrc'); sys.path.insert(0, r'$gsSrc\GPT_SoVITS'); import os; os.environ['bert_path'] = r'$gsModel\chinese-roberta-wwm-ext-large'; from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config; print('gptsovits import ok')"
