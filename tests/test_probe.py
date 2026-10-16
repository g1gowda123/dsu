import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.probe_dataset import bounded_walk, parse_classes_from_file, sample_file_head


class TestProbeDataset(unittest.TestCase):
    def test_probe_on_synthetic_tree(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            train_dir = root / "train" / "annos"
            train_dir.mkdir(parents=True)

            # Create a synthetic VOC-style XML annotation
            xml_content = """<annotation>
  <folder>test</folder>
  <filename>001.jpg</filename>
  <size><width>1920</width><height>1080</height></size>
  <object>
    <name>autorickshaw_Bajaj</name>
    <bndbox><xmin>100</xmin><ymin>200</ymin><xmax>300</xmax><ymax>400</ymax></bndbox>
  </object>
  <object>
    <name>car_Maruti_Swift</name>
    <bndbox><xmin>400</xmin><ymin>500</ymin><xmax>600</xmax><ymax>700</ymax></bndbox>
  </object>
</annotation>"""
            xml_file = train_dir / "001.xml"
            xml_file.write_text(xml_content, encoding="utf-8")

            all_files, ext_counter, dir_ext_counts, split_dirs, total_walked = bounded_walk(root)
            self.assertEqual(total_walked, 1)
            self.assertEqual(ext_counter[".xml"], 1)
            self.assertIn("train", split_dirs)

            classes = parse_classes_from_file(xml_file)
            self.assertEqual(classes, ["autorickshaw_Bajaj", "car_Maruti_Swift"])

            head = sample_file_head(xml_file)
            self.assertIn("autorickshaw_Bajaj", head)


if __name__ == "__main__":
    unittest.main()
