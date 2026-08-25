from sqlalchemy import Column, Float, String

from app.database import Base


class ServiceRecord(Base):
    __tablename__ = "service_records"

    id = Column(String(36), primary_key=True)
    vehicle_id = Column(String(64), nullable=False, index=True)
    logged_by = Column(String(64), nullable=True)

    component = Column(String(16), nullable=False)
    service_type = Column(String(24), nullable=False)
    service_date = Column(String(32), nullable=False)
    created_at = Column(String(32), nullable=False)

    km_on_component = Column(Float, nullable=False)
    odometer_km_at_service = Column(Float, nullable=False)
    install_km = Column(Float, nullable=False)

    basis = Column(String(24), nullable=False)
    expected_life_km_at_estimate = Column(Float, nullable=True)

    item_name = Column(String(120), nullable=True)
    is_original = Column(String(16), nullable=True)
    garage_name = Column(String(120), nullable=True)
    cost_lkr = Column(Float, nullable=True)
    notes = Column(String(500), nullable=True)


class VehicleBaseline(Base):
    __tablename__ = "vehicle_baseline"

    vehicle_id = Column(String(64), primary_key=True)
    owner_id = Column(String(64), nullable=True)
    condition = Column(String(8), nullable=False)

    baseline_odometer_km = Column(Float, nullable=False)
    trip_km_at_baseline = Column(Float, nullable=False)

    recorded_at = Column(String(32), nullable=False)
    updated_at = Column(String(32), nullable=False)


class ComponentHealthFloor(Base):
    __tablename__ = "component_health_floor"

    vehicle_id = Column(String(64), primary_key=True)
    component = Column(String(16), primary_key=True)
    health_pct = Column(Float, nullable=False)
    rul_km = Column(Float, nullable=False)
    observed_at = Column(String(32), nullable=False)
