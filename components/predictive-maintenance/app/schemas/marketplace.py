from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class PartOut(BaseModel):
    id: str
    component: str
    name: str
    brand: Optional[str] = None
    fits_note: Optional[str] = None
    price_lkr: float
    grade: Optional[str] = None
    supplier: Optional[str] = None
    supplier_url: Optional[str] = None
    in_stock: bool = True
    part_number: Optional[str] = None
    category: Optional[str] = None
    fits_models: Optional[str] = None
    fits_any_model: bool = False
    stock_count: Optional[int] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    warranty: Optional[str] = None


class GarageOut(BaseModel):
    id: str
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    area: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    services: List[str] = []
    services_raw: Optional[str] = None
    speciality: Optional[str] = None
    mechanics: Optional[int] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    labour_lkr: Optional[float] = None
    opening_hours: Optional[str] = None
    verified: bool = False
    coords_are_city_level: bool = False
    distance_km: Optional[float] = None


class PriceInsight(BaseModel):
    component: str
    sample_size: int
    low_lkr: Optional[float] = None
    median_lkr: Optional[float] = None
    high_lkr: Optional[float] = None
    is_reliable: bool = False
    note: str = ""


class ComponentMarketplace(BaseModel):
    component: str
    parts: List[PartOut]
    garages: List[GarageOut]
    observed_prices: PriceInsight
    estimated_total_lkr: Optional[float] = None


class PartCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    component: str
    brand: Optional[str] = None
    part_number: Optional[str] = None
    category: Optional[str] = None
    price_lkr: float = Field(..., gt=0)
    grade: Optional[str] = None
    supplier: Optional[str] = None
    supplier_url: Optional[str] = None
    vehicle_compatibility: List[str] = []
    fits_any_model: bool = False
    stock_count: Optional[int] = None
    in_stock: bool = True
    rating: Optional[float] = None
    review_count: Optional[int] = None
    warranty: Optional[str] = None


class PartUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    component: Optional[str] = None
    brand: Optional[str] = None
    part_number: Optional[str] = None
    category: Optional[str] = None
    price_lkr: Optional[float] = Field(None, gt=0)
    grade: Optional[str] = None
    supplier: Optional[str] = None
    supplier_url: Optional[str] = None
    vehicle_compatibility: Optional[List[str]] = None
    fits_any_model: Optional[bool] = None
    stock_count: Optional[int] = None
    in_stock: Optional[bool] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    warranty: Optional[str] = None


class GarageCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    address: Optional[str] = None
    city: Optional[str] = None
    area: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    services: List[str] = []
    speciality: List[str] = []
    mechanics: Optional[int] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    labour_lkr: Optional[float] = None
    opening_hours: Optional[str] = None
    verified: bool = False
    coords_are_city_level: bool = False


class GarageUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=160)
    address: Optional[str] = None
    city: Optional[str] = None
    area: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    services: Optional[List[str]] = None
    speciality: Optional[List[str]] = None
    mechanics: Optional[int] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    labour_lkr: Optional[float] = None
    opening_hours: Optional[str] = None
    verified: Optional[bool] = None
    coords_are_city_level: Optional[bool] = None


class MarketplaceBrowse(BaseModel):
    """The whole store: every part and every garage, in one response.

    Distinct from ComponentMarketplace, which answers "this component is worn,
    what now?" and is entered from a health screen. This answers "show me the
    store", so it is not scoped to one component and carries no advice or price
    benchmark - those only mean something in the context of a specific worn
    part.

    `components` lists the component keys actually present in `parts`, so the
    filter chips can be built from what exists rather than from a hardcoded
    list that might offer a category with nothing behind it.
    """

    parts: List[PartOut] = []
    garages: List[GarageOut] = []
    components: List[str] = []
    # True when `parts` was narrowed to a specific vehicle. The UI has to say
    # so - an unfiltered list looks identical, and a driver would reasonably
    # assume everything shown fits their car.
    filtered_to_vehicle: Optional[str] = None
