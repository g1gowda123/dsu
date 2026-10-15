"""Synthetic fixture self-test for convert_to_yolo.py."""

import tempfile
import unittest
from pathlib import Path
import numpy as np
import yaml

try:
    import cv2
except ImportError:
    cv2 = None

from scripts.convert_to_yolo import convert_dataset, map_class_name, CANONICAL_CLASSES


class TestConvertToYOLO(unittest.TestCase):
    def test_class_mapping(self):
        self.assertEqual(map_class_name("autorickshaw_Bajaj_RE"), "auto_rickshaw")
        self.assertEqual(map_class_name("scooter_Honda_Activa"), "motorcycle")
        self.assertEqual(map_class_name("motorcycle_Bajaj_Pulsar"), "motorcycle")
        self.assertEqual(map_class_name("car_Maruti_Swift"), "car")
        self.assertEqual(map_class_name("bus_Tata"), "bus")
        self.assertEqual(map_class_name("mini-bus_Others"), "bus")
        self.assertEqual(map_class_name("truck_AshokLeyland"), "truck")
        self.assertIsNone(map_class_name("bicycle_Hero"))
        self.assertIsNone(map_class_name("pedestrian"))

    def test_synthetic_conversion(self):
        with tempfile.TemporaryDirectory() as src_dir, tempfile.TemporaryDirectory() as out_dir:
            src_root = Path(src_dir)
            out_root = Path(out_dir)

            train_annos = src_root / "train" / "annos"
            train_images = src_root / "train" / "images"
            val_annos = src_root / "val" / "annos"
            val_images = src_root / "val" / "images"
            test_annos = src_root / "test" / "annos"
            test_images = src_root / "test" / "images"

            for d in (train_annos, train_images, val_annos, val_images, test_annos, test_images):
                d.mkdir(parents=True)

            # Create 3 synthetic XMLs and 3 dummy images
            # Image 1 (train): auto_rickshaw (box from 100, 100 to 300, 300)
            xml1 = """<annotation>
  <size><width>640</width><height>480</height></size>
  <object>
    <name>autorickshaw_Bajaj</name>
    <bndbox><xmin>100</xmin><ymin>100</ymin><xmax>300</xmax><ymax>300</ymax></bndbox>
  </object>
</annotation>"""
            (train_annos / "001.xml").write_text(xml1, encoding="utf-8")
            dummy_img = np.zeros((480, 640, 3), dtype=np.uint8)
            if cv2 is not None:
                cv2.imwrite(str(train_images / "001.jpg"), dummy_img)

            # Image 2 (train): scooter (mapped to motorcycle, box from 200, 200 to 400, 400)
            xml2 = """<annotation>
  <size><width>640</width><height>480</height></size>
  <object>
    <name>scooter_Honda_Activa</name>
    <bndbox><xmin>200</xmin><ymin>200</ymin><xmax>400</xmax><ymax>400</ymax></bndbox>
  </object>
</annotation>"""
            (train_annos / "002.xml").write_text(xml2, encoding="utf-8")
            if cv2 is not None:
                cv2.imwrite(str(train_images / "002.jpg"), dummy_img)

            # Image 3 (val): car (box from 50, 50 to 250, 250)
            xml3 = """<annotation>
  <size><width>640</width><height>480</height></size>
  <object>
    <name>car_Hyundai_i20</name>
    <bndbox><xmin>50</xmin><ymin>50</ymin><xmax>250</xmax><ymax>250</ymax></bndbox>
  </object>
</annotation>"""
            (val_annos / "003.xml").write_text(xml3, encoding="utf-8")
            if cv2 is not None:
                cv2.imwrite(str(val_images / "003.jpg"), dummy_img)

            # Run conversion
            convert_dataset(root=src_root, out_dir=out_root, qa=True)

            # Check label files
            lbl1 = out_root / "labels" / "train" / "001.txt"
            self.assertTrue(lbl1.exists())
            content1 = lbl1.read_text(encoding="utf-8").strip().split()
            # auto_rickshaw is class 0
            self.assertEqual(content1[0], "0")
            # cx = (100+300)/2 / 640 = 200/640 = 0.3125
            self.assertAlmostEqual(float(content1[1]), 0.3125, places=3)

            lbl2 = out_root / "labels" / "train" / "002.txt"
            self.assertTrue(lbl2.exists())
            content2 = lbl2.read_text(encoding="utf-8").strip().split()
            # motorcycle is class 3
            self.assertEqual(content2[0], "3")

            lbl3 = out_root / "labels" / "val" / "003.txt"
            self.assertTrue(lbl3.exists())
            content3 = lbl3.read_text(encoding="utf-8").strip().split()
            # car is class 2
            self.assertEqual(content3[0], "2")

            # Check models/finetuned/data.yaml
            data_yaml = Path("models/finetuned/data.yaml")
            self.assertTrue(data_yaml.exists())
            with open(data_yaml, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f)
            self.assertEqual(cfg["names"][0], "auto_rickshaw")
            self.assertEqual(cfg["names"][1], "bus")
            self.assertEqual(cfg["names"][2], "car")
            self.assertEqual(cfg["names"][3], "motorcycle")
            self.assertEqual(cfg["names"][4], "truck")


if __name__ == "__main__":
    unittest.main()
