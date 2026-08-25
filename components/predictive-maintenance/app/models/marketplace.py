from sqlalchemy import Column, Float, Integer, String

from app.database import Base


class Part(Base):
    __tablename__ = "parts"

    id = Column(String(36), primary_key=True)
    component = Column(String(16), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    brand = Column(String(80), nullable=True)
    fits_note = Column(String(160), nullable=True)
    price_lkr = Column(Float, nullable=False)
    grade = Column(String(16), nullable=True)
    supplier = Column(String(120), nullable=True)
    supplier_url = Column(String(300), nullable=True)
    in_stock = Column(Integer, nullable=False, default=1)
    updated_at = Column(String(32), nullable=True)

    part_number = Column(String(64), nullable=True)
    category = Column(String(64), nullable=True)
    fits_models = Column(String(400), nullable=True)
    fits_any_model = Column(Integer, nullable=True, default=0)
    stock_count = Column(Integer, nullable=True)
    rating = Column(Float, nullable=True)
    review_count = Column(Integer, nullable=True)
    warranty = Column(String(64), nullable=True)


class Garage(Base):
    __tablename__ = "garages"

    id = Column(String(36), primary_key=True)
    name = Column(String(160), nullable=False)
    address = Column(String(300), nullable=True)
    city = Column(String(80), nullable=True, index=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    phone = Column(String(40), nullable=True)
    services = Column(String(160), nullable=True)
    services_raw = Column(String(400), nullable=True)
    speciality = Column(String(240), nullable=True)
    area = Column(String(120), nullable=True)
    email = Column(String(160), nullable=True)
    mechanics = Column(Integer, nullable=True)
    review_count = Column(Integer, nullable=True)
    coords_are_city_level = Column(Integer, nullable=True, default=0)
    rating = Column(Float, nullable=True)
    labour_lkr = Column(Float, nullable=True)
    opening_hours = Column(String(160), nullable=True)
    verified = Column(Integer, nullable=False, default=0)
    updated_at = Column(String(32), nullable=True)
