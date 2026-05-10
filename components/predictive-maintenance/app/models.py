from sqlalchemy import Column, Integer, String, Float
from app.database import Base


class TripMetrics(Base):
    __tablename__ = "trip_metrics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trip_id = Column(String(36), unique=True, nullable=False, index=True)
    vehicle_id = Column(String(64), nullable=False, index=True)
    driver_id = Column(String(64), nullable=False)
    start_timestamp = Column(String(32), nullable=False)
    stored_at = Column(String(32), nullable=False)

    duration_minutes = Column(Float, nullable=False)
    distance_km = Column(Float, nullable=False)

    # Engine features
    avg_rpm = Column(Float, nullable=False)
    max_rpm = Column(Float, nullable=False)
    avg_engine_load = Column(Float, nullable=False)
    max_coolant_temp_c = Column(Float, nullable=False)
    ltft_std = Column(Float, nullable=False)

    # Brake features
    braking_events = Column(Integer, nullable=False)
    braking_frequency = Column(Float, nullable=False)
    avg_deceleration_intensity = Column(Float, nullable=False)

    # Tire features
    cornering_events = Column(Integer, nullable=False)
    cornering_frequency = Column(Float, nullable=False)
    avg_speed_kmh = Column(Float, nullable=False)
    total_mileage_km = Column(Float, nullable=False)

    # Battery features
    avg_battery_voltage_v = Column(Float, nullable=False)
    min_battery_voltage_v = Column(Float, nullable=False)
    voltage_std = Column(Float, nullable=False)
    avg_iat_c = Column(Float, nullable=False)
