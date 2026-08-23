"""Drift guards between the checked-in OpenAPI contract and the FastAPI app.

Every other test here drives the app only, so a contract that no longer parses —
or no longer lists the routes the app actually serves — ships unnoticed.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from fastapi.routing import APIRoute

from src.api import app
from src.auth import require_user

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"
YAML_PATH = CONTRACTS / "geo-intelligence.openapi.yaml"
JSON_PATH = CONTRACTS / "geo-intelligence.openapi.json"

HTTP_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}


def _operations(spec: dict) -> set[tuple[str, str]]:
    return {
        (method.upper(), path)
        for path, item in spec["paths"].items()
        for method in item
        if method in HTTP_METHODS
    }


def _depends_on_require_user(dependant) -> bool:
    return any(
        sub.call is require_user or _depends_on_require_user(sub)
        for sub in dependant.dependencies
    )


def _app_operations() -> dict[tuple[str, str], bool]:
    """(METHOD, path) -> whether the route is behind require_user."""
    return {
        (method, route.path): _depends_on_require_user(route.dependant)
        for route in app.routes
        if isinstance(route, APIRoute) and route.include_in_schema
        for method in route.methods
    }


@pytest.fixture(scope="module")
def contract() -> dict:
    return yaml.safe_load(YAML_PATH.read_text())


def test_yaml_contract_parses(contract):
    assert contract["openapi"].startswith("3.")
    assert contract["paths"]


def test_contract_operations_match_registered_routes(contract):
    assert _operations(contract) == set(_app_operations())


def test_json_and_yaml_contracts_describe_the_same_operations(contract):
    assert _operations(json.loads(JSON_PATH.read_text())) == _operations(contract)


def test_authenticated_routes_declare_the_security_scheme(contract):
    schemes = contract["components"]["securitySchemes"]
    for (method, path), secured in _app_operations().items():
        operation = contract["paths"][path][method.lower()]
        declared = operation.get("security", contract.get("security", []))
        assert bool(declared) == secured, f"{method} {path} security mismatch"
        for requirement in declared:
            assert set(requirement) <= set(schemes), f"{method} {path} unknown scheme"


def test_health_is_public_in_the_contract(contract):
    assert "security" not in contract["paths"]["/v1/health"]["get"]
    assert not contract.get("security")
