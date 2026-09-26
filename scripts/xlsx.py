"""Read .xlsx without dependencies: values AND formulas.

An .xlsx is a zip of XML. Every cell that is computed carries its formula
in an <f> tag next to the cached result in <v>, which is exactly what we
need to tell a typed value apart from a calculated one.
"""
import zipfile
import re
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
RNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def col_of(ref):
    return re.match(r'[A-Z]+', ref).group(0)


def row_of(ref):
    return int(re.search(r'\d+', ref).group(0))


def col_index(col):
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n


class Xlsx:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self.shared = self._shared_strings()
        self.sheets = self._sheets()

    def _shared_strings(self):
        if 'xl/sharedStrings.xml' not in self.z.namelist():
            return []
        root = ET.fromstring(self.z.read('xl/sharedStrings.xml'))
        out = []
        for si in root.findall(f'{NS}si'):
            out.append(''.join(t.text or '' for t in si.iter(f'{NS}t')))
        return out

    def _sheets(self):
        rels = {}
        rel_root = ET.fromstring(self.z.read('xl/_rels/workbook.xml.rels'))
        for r in rel_root:
            rels[r.get('Id')] = r.get('Target').lstrip('/')
        wb = ET.fromstring(self.z.read('xl/workbook.xml'))
        out = []
        for sh in wb.find(f'{NS}sheets'):
            target = rels.get(sh.get(f'{RNS}id'), '')
            if not target.startswith('xl/'):
                target = 'xl/' + target
            out.append((sh.get('name'), target))
        return out

    def cells(self, target):
        """Yield (ref, value, formula) for every non-empty cell."""
        root = ET.fromstring(self.z.read(target))
        data = root.find(f'{NS}sheetData')
        if data is None:
            return
        for row in data:
            for c in row:
                ref = c.get('r')
                t = c.get('t')
                f = c.find(f'{NS}f')
                formula = ('=' + (f.text or '')) if f is not None else None
                v = c.find(f'{NS}v')
                if t == 's' and v is not None:
                    val = self.shared[int(v.text)]
                elif t == 'inlineStr':
                    is_el = c.find(f'{NS}is')
                    val = ''.join(x.text or '' for x in is_el.iter(f'{NS}t')) if is_el is not None else ''
                else:
                    val = v.text if v is not None else None
                if val is None and formula is None:
                    continue
                yield ref, val, formula

    def grid(self, target, max_row=None):
        """{row: {col: (value, formula)}}"""
        g = {}
        for ref, val, formula in self.cells(target):
            r = row_of(ref)
            if max_row and r > max_row:
                continue
            g.setdefault(r, {})[col_of(ref)] = (val, formula)
        return g


def show(grid, rows, cols=None, width=22):
    """Print a few rows as a table, marking formulas with '='."""
    for r in rows:
        if r not in grid:
            continue
        row = grid[r]
        keys = cols or sorted(row.keys(), key=col_index)
        cells = []
        for k in keys:
            val, f = row.get(k, (None, None))
            s = f if f else (val if val is not None else '')
            cells.append(f'{k}:{str(s)[:width]}')
        print(f'  r{r:<4} ' + ' | '.join(cells))
