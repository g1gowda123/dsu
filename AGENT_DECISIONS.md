# Agent Decisions Log

Log of architectural choices, deviations, and judgment calls during development.

- Installed CPU-only PyTorch (`torch==2.14.1+cpu` and `torchvision==0.29.1+cpu`) from the PyTorch CPU index to maintain the lightweight CCTV edge deployment thesis and avoid heavy CUDA runtime dependencies.
- Verified `yolo26n.pt` downloaded and executed NMS-free inference directly with `ultralytics==8.4.177` without model substitution.
- Implemented `test_placeholder.py` to validate existence, parsing, and required schema keys for `app.yaml`, `emission_factors.yaml`, and `camera_calibration.yaml`.
- Verified CPU-only environment: uninstalled `nvidia-ml-py` so `pip list | grep -i nvidia` is empty and `torch.cuda.is_available()` is False. Pinned `--extra-index-url https://download.pytorch.org/whl/cpu` on line 1 of requirements.txt with `torch==2.14.1+cpu` and `torchvision==0.29.1+cpu`.
