# Tagging engines

## Disabled (default)

```dotenv
TAGGING_ENGINE=none
```

The gallery runs without Python, PyTorch, or model weights. Saved tags remain searchable, and the tagging action is hidden and disabled on the server.

## RAM++

Use a Python environment with Pillow, PyTorch, Hugging Face Hub, and the [Recognize Anything package](https://github.com/xinyu1205/recognize-anything). Follow that project's installation instructions for your CPU/CUDA setup. The tested local environment uses Python 3.12. Point `TAGGER_PYTHON` at that environment; the gallery never installs into or modifies it.

```dotenv
TAGGING_ENGINE=ram++
TAGGER_PYTHON=/absolute/path/to/venv/bin/python
RAM_DEVICE=auto
RAM_THREADS=4
# Optional: use a checkpoint already downloaded elsewhere.
# RAM_CHECKPOINT=/absolute/path/to/ram_plus_swin_large_14m.pth
```

Before the first run, download the RAM++ checkpoint and BERT tokenizer into that interpreter's Hugging Face cache. This setup step requires network access:

```sh
/path/to/venv/bin/python - <<'PY'
from huggingface_hub import hf_hub_download
from transformers import BertTokenizer
hf_hub_download('xinyu1205/recognize-anything-plus-model', 'ram_plus_swin_large_14m.pth')
BertTokenizer.from_pretrained('bert-base-uncased')
PY
```

If you set `HF_HOME` in `.env.local`, also set it in the shell for this setup command so the caches match. The worker runs with Hugging Face and Transformers offline modes enabled. RAM++ supports its Swin-Large, 384-pixel model; `RAM_CHECKPOINT` selects compatible weights, not a different architecture.

`auto` selects CUDA when available with more than 4 GiB free, otherwise CPU. CUDA allocation failures fall back to CPU. The model loads once per batch and exits afterward. Labels are approximate and can be incorrect.

## Custom Python adapter

Install Pillow and any dependencies your engine needs in a Python environment. Configure:

```dotenv
TAGGING_ENGINE=custom
TAGGER_PYTHON=/absolute/path/to/venv/bin/python
TAGGER_PLUGIN=/absolute/path/to/my_tagger.py
```

The adapter exports a factory called `create_tagger()`. The factory is called once per batch. It returns a callable accepting a Pillow RGB image and returning a list of tag strings (or a comma/pipe-separated string). For example:

```python
def create_tagger():
    from my_recognizer import load_model
    model = load_model()

    def tag(image):
        return model.predict_labels(image)

    return tag
```

This example describes the adapter contract; `my_recognizer` is your own model integration. A callable object may expose a `device` attribute for status reporting. The built-in worker handles Procreate preview extraction, image orientation/transparency, normalization, duplicate removal, progress, failed items, resumable saves, and process locking. RAM++ dependencies are not imported for custom engines. A custom adapter is trusted administrator code and can make network calls; the gallery does not impose RAM++'s local-only behavior on other libraries.

## Storage, failures, and retagging

Tags live in `DATA_DIR/tags.json`, with progress in `tagging-status.json` and diagnostics in `tagging.log`. Each record includes the artwork's relative-path ID, version, generated labels, and generation time. New results record the selected engine. The manifest and logs contain private filesystem information and must not be published.

Restarting the systemd service interrupts its worker. Select **Tag untagged** after restart to resume saved progress. The worker skips damaged documents and retries failed records on the next run.

Changing engines does not erase or overwrite successful existing tags. To retag everything, stop the service, back up and move `DATA_DIR/tags.json` out of that location, start the service, and select **Tag untagged**. Keep the media root stable: artwork IDs are derived from paths relative to that root.
