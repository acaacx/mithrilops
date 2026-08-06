"""Same-origin SPA serving (replaces the Azure Static Web App)."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from secureflow_api.spa import mount_spa


def make_client(tmp_path: Path) -> tuple[TestClient, str]:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    index_html = "<html><body>secureflow spa</body></html>"
    (dist / "index.html").write_text(index_html)
    (dist / "assets" / "app.js").write_text("console.log('app')")
    (dist / "favicon.svg").write_text("<svg/>")
    (tmp_path / "outside.txt").write_text("secret")

    app = FastAPI()

    @app.get("/api/ping")
    async def ping() -> dict[str, bool]:
        return {"ok": True}

    mount_spa(app, dist)
    return TestClient(app), index_html


def test_root_serves_index(tmp_path: Path) -> None:
    client, index_html = make_client(tmp_path)
    res = client.get("/")
    assert res.status_code == 200
    assert res.text == index_html


def test_deep_link_falls_back_to_index(tmp_path: Path) -> None:
    client, index_html = make_client(tmp_path)
    res = client.get("/applications/app-1/runs")
    assert res.status_code == 200
    assert res.text == index_html


def test_asset_is_served(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    res = client.get("/assets/app.js")
    assert res.status_code == 200
    assert "console.log" in res.text


def test_top_level_file_is_served(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    res = client.get("/favicon.svg")
    assert res.status_code == 200
    assert res.text == "<svg/>"


def test_api_routes_still_win(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    assert client.get("/api/ping").json() == {"ok": True}


def test_unknown_api_path_is_404_not_index(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    assert client.get("/api/nope").status_code == 404


def test_traversal_cannot_escape_dist(tmp_path: Path) -> None:
    client, index_html = make_client(tmp_path)
    res = client.get("/..%2Foutside.txt")
    # Whatever the URL normalization does, the file outside dist must not leak.
    assert res.status_code in (200, 404)
    assert res.text != "secret"
