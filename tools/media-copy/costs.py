"""What a pass would cost at list prices. Written from memory on Oct 31, 2026 and not checked against the live price pages, so
check them before a big run: Google's Cloud Storage pricing (us-west1, Standard, internet egress) and Amazon's S3 and VPC pricing
(us-west-2). AWS credits pay the AWS lines. Google's lines are a real bill on Google's side."""
from __future__ import annotations

PRICES_AS_OF = "2026-10-31, from memory, not checked against the live price pages"
GB = 10 ** 9

GCS_EGRESS_TIERS = ((1_000, 0.12), (9_000, 0.11), (float("inf"), 0.08))  # (GB in this tier, $ per GB) to the internet
GCS_CLASS_B_PER_1K = 0.0004  # a read
GCS_CLASS_A_PER_1K = 0.005  # a listing page
S3_PUT_PER_1K = 0.005  # PUT, multipart calls, LIST
S3_HEAD_PER_1K = 0.0004  # HEAD, GET
S3_STORAGE_PER_GB_MONTH = 0.023  # Standard
NAT_PER_GB = 0.045  # only if the machine sits behind a NAT gateway: that's why the plan runs it on a public subnet


def egress_usd(size_bytes: int) -> float:
    left, total = size_bytes / GB, 0.0
    for tier_gb, price in GCS_EGRESS_TIERS:
        here = min(left, tier_gb)
        total += here * price
        left -= here
        if left <= 0:
            break
    return total


def estimate(size_bytes: int, objects: int, parts: int, list_pages: int) -> dict:
    """objects: files to copy. parts: S3 write calls for them. list_pages: one per 1,000 objects listed, on each side."""
    gb = size_bytes / GB
    google = {
        "egress_usd": egress_usd(size_bytes),
        "class_b_usd": parts * GCS_CLASS_B_PER_1K / 1000,
        "class_a_usd": list_pages * GCS_CLASS_A_PER_1K / 1000,
    }
    aws = {
        "put_usd": (parts + list_pages) * S3_PUT_PER_1K / 1000,
        "head_usd": objects * 2 * S3_HEAD_PER_1K / 1000,
    }
    one_time = sum(google.values()) + sum(aws.values())
    aws["storage_usd_per_month"] = gb * S3_STORAGE_PER_GB_MONTH
    aws["nat_usd_if_behind_a_nat_gateway"] = gb * NAT_PER_GB
    return {"one_time_usd": round(one_time, 7), "google": _rounded(google), "aws": _rounded(aws), "prices_as_of": PRICES_AS_OF}


def _rounded(prices: dict[str, float]) -> dict[str, float]:
    return {k: round(v, 7) for k, v in prices.items()}
