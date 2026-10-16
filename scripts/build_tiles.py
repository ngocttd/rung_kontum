"""Build XYZ tiles (public/tiles/<overlay-id>/{z}/{x}/{y}.png) for classified rasters so they stay sharp
when zoomed in (single-image overlays are ~30-65 m/px). The web attaches tiles automatically when
public/tiles/<id>/tilejson.json exists (src/data/repo.js overlays()).

  python scripts/build_tiles.py [ids...]      # default: all
"""
import os, sys, json, subprocess, importlib.util
from pathlib import Path
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parents[1]
P = ROOT / 'data/processed'; OUT = ROOT / 'public/tiles'
LC = {"1": "#267300", "2": "#737300", "3": "#734c00", "4": "#730000", "5": "#002673", "6": "#73004c", "7": "#00734c"}

def forest_change():
    """1 stable forest, 2 loss, 3 gain between the project land-cover maps 1991 and 2023 (15 m)."""
    out = P / 'lc-forest-change-1991-2023-15m.tif'
    if out.exists(): return out
    with rasterio.open(P / 'landcover-1991-15m.tif') as a, rasterio.open(P / 'landcover-2023-15m.tif') as b:
        c0, c1 = a.read(1), b.read(1); prof = a.profile
    f0, f1 = c0 == 1, c1 == 1; valid = (c0 > 0) & (c1 > 0)
    chg = np.zeros(c0.shape, dtype='uint8'); chg[valid & f0 & f1] = 1; chg[valid & f0 & ~f1] = 2; chg[valid & ~f0 & f1] = 3
    prof.update(driver='GTiff', dtype='uint8', count=1, nodata=0, compress='deflate', tiled=True)
    with rasterio.open(out, 'w', **prof) as d: d.write(chg, 1)
    return out

def ramp_palette(lo, hi, stops):
    xs = [s[0] for s in stops]; cs = np.array([[int(s[1][i:i + 2], 16) for i in (1, 3, 5)] for s in stops], dtype=float)
    return {str(v): '#%02x%02x%02x' % tuple(int(np.interp(v, xs, cs[:, i])) for i in range(3)) for v in range(lo, hi + 1)}

JOBS = {
    'lc-1991': lambda: (P / 'landcover-1991-15m.tif', LC, 14),
    'lc-2014': lambda: (P / 'landcover-2014-15m.tif', LC, 14),
    'lc-2023': lambda: (P / 'landcover-2023-15m.tif', LC, 14),
    'lc-forest-change-1991-2023': lambda: (forest_change(), {"1": ["#9fd39a", 120], "2": "#e0322d", "3": "#1677d2"}, 14),
    'worldcover-2021': lambda: (P / 'worldcover-2021-10m.tif', {"10": "#006400", "20": "#ffbb22", "30": "#ffff4c", "40": "#f096ff", "50": "#fa0000", "60": "#b4b4b4", "80": "#0064c8", "90": "#0096a0"}, 14),
    'hansen-loss': lambda: (P / 'forest-lossyear-hansen-30m.tif', ramp_palette(1, 24, [(1, '#fde68a'), (8, '#fb923c'), (16, '#e11d48'), (24, '#7e1d6b')]), 13),
}

def main():
    ids = sys.argv[1:] or list(JOBS)
    for i in ids:
        src, pal, zmax = JOBS[i]()
        if not Path(src).exists(): print('skip (missing source)', i); continue
        out = OUT / i
        print('tiles', i, flush=True)
        subprocess.run([sys.executable, str(ROOT / 'scripts/make_tiles.py'), str(src), str(out), '--zmin', '7', '--zmax', str(zmax), '--mode', 'classes', '--clip', '--palette', json.dumps(pal)], check=True)

if __name__ == '__main__':
    main()
