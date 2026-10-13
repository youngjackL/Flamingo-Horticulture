import io
import base64
import os
from datetime import datetime
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client

# Supabase configuration
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://your-supabase-project.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY", "your-anon-key")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI(title="Flamingo Horticulture CDU CV Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://cdu.flamingo-horticulture.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


# ── OpenCV Processing Pipeline ────────────────────────────────────────────

def compute_pixel_to_cm_ratio(
    hsv_image: np.ndarray,
    sticker_color: str,
    known_reference_cm: float,
) -> Optional[float]:
    """Determine pixel‑to‑cm ratio by isolating the reference calibration sticker."""

    if sticker_color.lower() == "yellow":
        # Yellow sticker mask: H ≈ 18‑35
        mask = cv2.inRange(
            hsv_image, (18, 100, 100), (35, 255, 255)
        )
    elif sticker_color.lower() == "red":
        # Red sticker mask: H ≈ 0‑10 AND H ≈ 170‑180
        mask1 = cv2.inRange(hsv_image, (0, 100, 100), (10, 255, 255))
        mask2 = cv2.inRange(hsv_image, (170, 100, 100), (180, 255, 255))
        mask = cv2.bitwise_or(mask1, mask2)
    else:
        return None

    # Morphology to clean noise
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    # Find contours and filter by aspect ratio ≈ 1.0 (square/circular sticker)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        aspect = float(w) / h if h > 0 else 0
        if 0.8 <= aspect <= 1.2:  # Accept square‑like stickers
            pixel_width = w
            return known_reference_cm / pixel_width if pixel_width > 0 else None

    return None


def segment_green_stalks(hsv_image: np.ndarray) -> tuple:
    """Isolate green plant stems using HSV masking and contour detection."""

    # Green hue range: H ≈ 35‑85
    green_mask = cv2.inRange(
        hsv_image, (35, 50, 50), (85, 255, 255)
    )

    # Morphological opening/closing to eliminate specks
    kernel = np.ones((3, 3), np.uint8)
    green_mask = cv2.morphologyEx(green_mask, cv2.MORPH_OPEN, kernel)
    green_mask = cv2.morphologyEx(green_mask, cv2.MORPH_CLOSE, kernel)

    # Find contours of green regions
    contours, _ = cv2.findContours(
        green_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    stem_heights_px = []
    bud_diameters_px = []

    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)

        # Vertical stalks: height exceeds width
        if h > w:
            stem_heights_px.append(h)

        # Bud diameter heuristic: compact vertical-ish contours
        area = cv2.contourArea(cnt)
        if 200 < area < 5000 and h > 0:
            aspect = float(w) / h
            if 0.3 <= aspect <= 0.7:
                bud_diameters_px.append(h)

    return stem_heights_px, bud_diameters_px


def compute_yield_units(
    crop_type: str,
    avg_stem_height_cm: float,
    avg_bud_diameter_cm: float,
) -> int:
    """Crop‑specific yield heuristic based on stem height and bud diameter."""

    height_factor = 1.0
    bud_factor = 1.0
    base_multiplier = 150

    if crop_type.lower() == "roses":
        height_factor = 1.0
        bud_factor = 0.8
        base_multiplier = 150
    elif crop_type.lower() == "carnations":
        height_factor = 1.2
        bud_factor = 0.6
        base_multiplier = 200
    elif crop_type.lower() == "chrysanthemums":
        height_factor = 0.9
        bud_factor = 1.0
        base_multiplier = 180
    else:
        height_factor = 1.0
        bud_factor = 1.0
        base_multiplier = 150

    estimated = (avg_stem_height_cm * height_factor) * (
        avg_bud_diameter_cm * bud_factor
    ) * base_multiplier / 100
    return max(100, round(estimated))


# ── API Endpoints ──────────────────────────────────────────────────────────

@app.get("/api/v1/cdu/blocks")
async def list_blocks():
    """Return all active greenhouse blocks."""
    try:
        response = supabase.table("greenhouse_blocks").select("*").execute()
        return {"status": "success", "blocks": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/cdu/scan")
async def scan_crop_frame(
    file: UploadFile = File(...),
    block_id: str = ...,
    crop_type: str = ...,
    sticker_color: str = ...,
    known_reference_cm: float = ...,
):
    """Process a crop frame: HSV masking, sticker calibration, stem measurement, yield estimate."""

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Invalid file type. Expected JPEG/PNG.")

    # Read image bytes into numpy array
    image_bytes = await file.read()
    nparr = np.frombuffer(image_bytes, np.uint8)
    bgr_image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if bgr_image is None:
        raise HTTPException(status_code=400, detail="Unable to decode image.")

    # Convert to HSV for color‑based isolation
    hsv_image = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2HSV)

    # 1️⃣ Compute pixel‑to‑cm ratio from reference sticker
    pixel_to_cm = compute_pixel_to_cm_ratio(
        hsv_image, sticker_color, known_reference_cm
    )
    if pixel_to_cm is None:
        raise HTTPException(
            status_code=422, detail="Reference calibration sticker not detected."
        )

    # 2️⃣ Segment green stalks and measure
    stem_heights_px, bud_diameters_px = segment_green_stalks(hsv_image)

    if not stem_heights_px:
        raise HTTPException(
            status_code=422, detail="No green stalks detected in frame."
        )

    # Convert pixel measurements to centimeters
    avg_stem_height_px = np.mean(stem_heights_px)
    avg_stem_height_cm = round(avg_stem_height_px * pixel_to_cm, 2)

    # Average bud diameter if detected; otherwise use reasonable fallback
    if bud_diameters_px:
        avg_bud_diameter_px = np.mean(bud_diameters_px)
        avg_bud_diameter_cm = round(avg_bud_diameter_px * pixel_to_cm, 2)
    else:
        # Fallback: estimate bud diameter as ~15% of stem height (crop‑agnostic)
        avg_bud_diameter_cm = round(avg_stem_height_cm * 0.15, 2)

    # 3️⃣ Compute estimated yield units (crop‑specific algorithm)
    estimated_yield = compute_yield_units(crop_type, avg_stem_height_cm, avg_bud_diameter_cm)

    # 4️⃣ Confidence score based on detector heuristics
    confidence_score = round(min(1.0, 0.9 + 0.02 * len(stem_heights_px)), 2)

    # 5️⃣ Log telemetry to Supabase
    image_url = None
    if os.getenv("SUPABASE_STORAGE_BUCKET"):
        try:
            base64_data = base64.b64encode(image_bytes).decode("utf-8")
            # Store scan image in Supabase storage (placeholder - actual upload logic depends on bucket config)
            response = (
                supabase.storage.from_(os.getenv("SUPABASE_STORAGE_BUCKET"))
                .upload(
                    path=f"scans/{datetime.utcnow().timestamp()}_{file.filename}",
                    file=base64_data,
                    file_options={"content-type": file.content_type},
                )
            )
            image_url = supabase.storage.from_(os.getenv("SUPABASE_STORAGE_BUCKET")).get_public_url(
                path=f"scans/{datetime.utcnow().timestamp()}_{file.filename}"
            )
        except Exception:
            image_url = None

    # Insert growth scan record
    scan_record = {
        "block_id": block_id,
        "crop_type": crop_type,
        "avg_stem_height_cm": avg_stem_height_cm,
        "avg_bud_diameter_cm": avg_bud_diameter_cm,
        "estimated_yield_units": estimated_yield,
        "confidence_score": confidence_score,
        "image_url": image_url,
    }

    try:
        supabase.table("growth_scans").insert(scan_record).execute()
    except Exception:
        pass  # Non-fatal if telemetry insert fails; UI still returns results

    # Return scan telemetry response
    return {
        "status": "success",
        "crop_type": crop_type,
        "avg_stem_height_cm": avg_stem_height_cm,
        "avg_bud_diameter_cm": avg_bud_diameter_cm,
        "estimated_yield_units": estimated_yield,
        "confidence_score": confidence_score,
        "sticker_detected": pixel_to_cm is not None,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@app.get("/api/v1/cdu/telemetry")
async def get_telemetry():
    """Return recent growth scan logs."""
    try:
        response = supabase.table("growth_scans").select(
            "*, greenhouse_blocks(block_name, variety)"
        ).order("scanned_at", desc=True).limit(20).execute()
        return {"status": "success", "scans": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/cdu/blocks")
async def create_block(
    block_name: str,
    variety: str,
    target_harvest_days: int,
):
    """Create a new greenhouse block entry."""
    try:
        record = {
            "block_name": block_name,
            "variety": variety,
            "target_harvest_days": target_harvest_days,
        }
        response = supabase.table("greenhouse_blocks").insert(record).execute()
        return {"status": "success", "block": response.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))