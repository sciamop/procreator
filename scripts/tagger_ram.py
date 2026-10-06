"""Optional RAM++ adapter. Imports are isolated from non-RAM installations."""
import os


class RAMTagger:
    def __init__(self):
        import torch
        from huggingface_hub import hf_hub_download
        from ram import get_transform
        from ram.models import ram_plus

        self.torch = torch
        threads = int(os.environ.get('RAM_THREADS') or '4')
        if threads < 1:
            raise ValueError('RAM_THREADS must be positive')
        torch.set_num_threads(min(threads, os.cpu_count() or 1))
        checkpoint = os.environ.get('RAM_CHECKPOINT') or hf_hub_download(
            repo_id='xinyu1205/recognize-anything-plus-model',
            filename='ram_plus_swin_large_14m.pth', local_files_only=True,
        )
        self.device = os.environ.get('RAM_DEVICE') or 'auto'
        if self.device not in ('auto', 'cpu', 'cuda'):
            raise ValueError('RAM_DEVICE must be auto, cpu, or cuda')
        if self.device == 'auto':
            self.device = 'cuda' if torch.cuda.is_available() and torch.cuda.mem_get_info()[0] > 4 * 1024 ** 3 else 'cpu'
        self.transform = get_transform(image_size=384)
        self.model = ram_plus(pretrained=checkpoint, image_size=384, vit='swin_l').eval()
        try:
            self.model = self.model.to(self.device)
        except torch.cuda.OutOfMemoryError:
            self.model = self.model.cpu(); self.device = 'cpu'; torch.cuda.empty_cache()

    def __call__(self, image):
        torch = self.torch
        tensor = self.transform(image).unsqueeze(0).to(self.device)
        try:
            with torch.inference_mode():
                generated, _ = self.model.generate_tag(tensor)
        except torch.cuda.OutOfMemoryError:
            self.model = self.model.cpu(); tensor = tensor.cpu(); self.device = 'cpu'; torch.cuda.empty_cache()
            with torch.inference_mode():
                generated, _ = self.model.generate_tag(tensor)
        return generated[0]
