from pathlib import Path
import yaml


def test_yaml_configs():
    config_dir = Path(__file__).parent.parent / "config"

    app_yaml = config_dir / "app.yaml"
    assert app_yaml.exists(), "config/app.yaml must exist"
    with open(app_yaml, "r", encoding="utf-8") as f:
        app_cfg = yaml.safe_load(f)
    assert "model" in app_cfg
    assert "imgsz" in app_cfg
    assert "confidence" in app_cfg

    emission_yaml = config_dir / "emission_factors.yaml"
    assert emission_yaml.exists(), "config/emission_factors.yaml must exist"
    with open(emission_yaml, "r", encoding="utf-8") as f:
        emission_cfg = yaml.safe_load(f)
    assert "classes" in emission_cfg
    assert "currency" in emission_cfg
    for cls_name in ["car", "motorcycle", "bus", "truck"]:
        assert cls_name in emission_cfg["classes"]

    camera_yaml = config_dir / "camera_calibration.yaml"
    assert camera_yaml.exists(), "config/camera_calibration.yaml must exist"
    with open(camera_yaml, "r", encoding="utf-8") as f:
        camera_cfg = yaml.safe_load(f)
    assert "camera" in camera_cfg
    assert "lanes" in camera_cfg
    assert "zones" in camera_cfg
    assert "homography" in camera_cfg
