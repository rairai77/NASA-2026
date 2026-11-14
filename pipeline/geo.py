"""Projection helpers (CONTRACTS §0, §2)."""
import numpy as np

R = 1737400.0  # m

def south_stereo_fwd(lat_deg, lon_deg):
    """Planetocentric lat/lon (deg) -> (x, y) meters. x = 2R u_y/(1-u_z), y = 2R u_x/(1-u_z)."""
    lat = np.radians(np.asarray(lat_deg, dtype=np.float64))
    lon = np.radians(np.asarray(lon_deg, dtype=np.float64))
    ux, uy, uz = np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)
    k = 2 * R / (1 - uz)
    return k * uy, k * ux

def south_stereo_inv(x, y):
    """(x, y) meters -> (lat_deg, lon_deg) with lon in [-180, 180]."""
    x = np.asarray(x, dtype=np.float64); y = np.asarray(y, dtype=np.float64)
    rho = np.hypot(x, y)
    lat = -90 + np.degrees(2 * np.arctan(rho / (2 * R)))
    lon = np.degrees(np.arctan2(x, y))
    return lat, lon

def stereo_pixel(level, lat_deg, lon_deg):
    """Continuous (row, col) where integer values are pixel centers."""
    x, y = south_stereo_fwd(lat_deg, lon_deg)
    return (level["y0"] - y) / level["pixel_m"] - 0.5, (x - level["x0"]) / level["pixel_m"] - 0.5

def stereo_pixel_center(level, row, col):
    """Pixel (row, col) -> (lat, lon) of the pixel center."""
    x = level["x0"] + (np.asarray(col) + 0.5) * level["pixel_m"]
    y = level["y0"] - (np.asarray(row) + 0.5) * level["pixel_m"]
    return south_stereo_inv(x, y)

def equirect_pixel(level, lat_deg, lon_deg):
    """Continuous (row, col) where integer values are pixel centers; lon wraps into [lon_min, lon_min+360)."""
    ppd = level["ppd"]
    lon = (np.asarray(lon_deg, dtype=np.float64) - level["lon_min"]) % 360.0
    return (level["lat_max"] - np.asarray(lat_deg, dtype=np.float64)) * ppd - 0.5, lon * ppd - 0.5

def equirect_pixel_center(level, row, col):
    ppd = level["ppd"]
    return level["lat_max"] - (np.asarray(row) + 0.5) / ppd, level["lon_min"] + (np.asarray(col) + 0.5) / ppd
