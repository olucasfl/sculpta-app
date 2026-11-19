"""Testes do caminho FLAME. Os que precisam dos modelos (licença própria, fora do Git) são ignorados se faltarem."""

from __future__ import annotations

import json
import struct

import numpy as np
import pytest

from app.face import bases, glb
from app.face.fit import FLAME_DIR
from app.face.reconstructor import QUALITY_CAP, quality_score

HAS_FLAME = (FLAME_DIR / "flame2023_Open.pkl").exists() and (FLAME_DIR / "FLAME_masks.pkl").exists()
needs_flame = pytest.mark.skipif(not HAS_FLAME, reason="modelos FLAME não instalados (assets/flame/x)")


def read_glb(data: bytes) -> dict:
    magic, version, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and version == 2 and length == len(data)
    jl = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20 : 20 + jl])


def test_quality_score_monotonico_e_com_teto():
    good = {"FRONT": (0.006, 0.01)}
    bad = {"FRONT": (0.05, 0.08)}
    assert quality_score(good, 9, 0.8) == QUALITY_CAP  # nunca "alta": não há validação contra escaneamento
    assert quality_score(bad, 9, 0.8) == 0.0
    mid = {"FRONT": (0.02, 0.03)}
    assert 0 < quality_score(mid, 9, 0.8) < quality_score({"FRONT": (0.012, 0.02)}, 9, 0.8)
    assert quality_score(mid, 3, 0.8) < quality_score(mid, 9, 0.8)  # menos vistas, menos confiança
    assert quality_score(mid, 9, 0.3) < quality_score(mid, 9, 0.8)  # pouca textura, menos confiança


def test_write_glb_formato_do_simulador():
    n = 6
    rng = np.random.default_rng(0)
    pos = rng.normal(size=(n, 3)).astype(np.float32)
    move = np.zeros((n, 3), np.float32)
    move[2] = (0.01, 0, 0)
    data = glb.write_glb(
        positions=pos,
        normals=pos,
        uvs=rng.random((n, 2)),
        indices=np.array([[0, 1, 2], [3, 4, 5]]),
        texture=b"\xff\xd8\xff\xe0jpg",
        targets=[dict(id="nose.alarWidth", positions=move, normals=np.zeros_like(move))],
        scalars={"_REGION_NOSE": np.linspace(0, 1, n)},
        extras={"kind": "RECONSTRUCTION"},
    )
    doc = read_glb(data)
    mesh = doc["meshes"][0]
    prim = mesh["primitives"][0]
    assert mesh["extras"]["targetNames"] == ["nose.alarWidth"] and mesh["extras"]["kind"] == "RECONSTRUCTION"
    assert {"POSITION", "NORMAL", "TEXCOORD_0", "_REGION_NOSE"} <= set(prim["attributes"])
    pos_acc = doc["accessors"][prim["targets"][0]["POSITION"]]
    assert pos_acc["sparse"]["count"] == 1  # só o vértice que se move
    assert doc["images"][0]["mimeType"] == "image/jpeg" and prim["material"] == 0


@needs_flame
def test_bases_do_flame_15_sliders_olhos_parados_e_simetria():
    from app.face import fit, texture

    fl = fit.load_flame()
    masks = texture.load_masks()
    V = fl["v0"]  # rosto médio do FLAME
    b = bases.build_bases(V, fl["faces"], masks)
    assert [t["id"] for t in b["targets"]] == [s for s, _ in bases.SLIDERS]
    assert b["weights"].shape == (len(V), len(bases.REGION_ORDER))
    assert 0.0 <= float(b["weights"].min()) and float(b["weights"].max()) <= 1.0
    eyes = np.concatenate([np.asarray(masks["left_eyeball"], int), np.asarray(masks["right_eyeball"], int)])
    for t in b["targets"]:
        moved = np.abs(t["positions"]).sum(axis=1) > 1e-9
        assert moved.any(), f"{t['id']} não move nada"
        assert not moved[eyes].any(), f"{t['id']} move os olhos"
        # deslocamento máximo visual: poucos milímetros a ~1 cm
        assert np.linalg.norm(t["positions"], axis=1).max() < 0.02
    # a largura da mandíbula é simétrica: o que sobe de um lado sobe do outro (módulo, em x)
    jaw = next(t for t in b["targets"] if t["id"] == "jaw.width")["positions"]
    left, right = V[:, 0] > 0.02, V[:, 0] < -0.02
    assert abs(np.abs(jaw[left, 0]).sum() - np.abs(jaw[right, 0]).sum()) / max(np.abs(jaw[:, 0]).sum(), 1e-9) < 0.25


@needs_flame
def test_silhueta_aproxima_a_forma_de_um_rosto_conhecido(monkeypatch):
    """Rosto sintético conhecido: fotos de frente e de perfil geradas por projeção. A silhueta de perfil deve
    deixar a forma mais perto da verdade na região do nariz e do queixo do que só os pontos."""
    import cv2

    from app.face import fit, silhouette, texture

    fl = fit.load_flame()
    masks = texture.load_masks()
    truth_beta = np.random.default_rng(3).normal(0, 0.8, fit.K_SHAPE)
    truth = fl["v0"] + np.einsum("vdk,k->vd", fl["sd"], truth_beta)
    L = fl["L0"] + fl["LD"] @ truth_beta
    H0, W0, Hh = 640, 480, 420.0  # imagem e altura de rosto em pixels

    def project(P, yaw):
        R = fit.rotmat([yaw, 0, 0])
        return fit.project(P @ R.T, 1.0 / 0.22, np.array([0.5, 0.5]), 1) * Hh

    def make_views():
        views = []
        for name, yaw in (("FRONT", 0), ("LEFT_45", 45), ("RIGHT_45", -45), ("LEFT_90", 70), ("RIGHT_90", -70)):
            obs = project(L, yaw)  # os 105 pontos de referência vistos de cada ângulo
            v = fit.View(name, np.zeros((H0, W0, 3), np.uint8), obs)
            views.append((v, yaw))
        return views

    pairs = make_views()
    views = [v for v, _ in pairs]
    yaw_of = {v.name: y for v, y in pairs}

    def fake_skin(view, _fl, _V, _mirror, _masks):
        mask = np.zeros((H0, W0), np.uint8)
        px = project(truth, yaw_of[view.name])
        for tri in fl["faces"]:
            cv2.fillConvexPoly(mask, px[tri].astype(np.int32), 1)
        return mask > 0

    monkeypatch.setattr(silhouette, "skin_mask", fake_skin)
    V0, beta0, mirror, _ = fit.fit_views(views, fl, log=lambda *_: None)
    face = np.asarray(masks["face"], int)
    base_err = np.linalg.norm(V0[face] - truth[face], axis=1).mean()
    V1, _b, info = silhouette.refine(views, fl, masks, beta0.copy(), mirror)
    new_err = np.linalg.norm(V1[face] - truth[face], axis=1).mean()
    assert info["used"] == 2
    print(f"erro da forma (mm): pontos {base_err * 1000:.2f} -> com silhueta {new_err * 1000:.2f}")
    assert new_err < base_err, f"a silhueta não melhorou a forma: {base_err * 1000:.2f} -> {new_err * 1000:.2f} mm"


def test_cobertura_de_cabelo_so_no_escuro_sem_cor_de_pele_acima_dos_olhos():
    import cv2

    from app.face import hair

    size = 256
    tex = np.zeros((size, size, 3), np.uint8)
    tex[:] = (110, 150, 200)  # BGR de pele
    tex[:100] = (20, 20, 24)  # faixa de cima: cabelo escuro
    ycc = cv2.cvtColor(tex, cv2.COLOR_BGR2YCrCb)
    assert ycc[200, 100, 1] >= 134  # a "pele" do teste realmente cai na faixa de pele

    m = hair.hair_mask(tex)
    assert m[40, 128] > 0.9 and m[200, 128] < 0.05

    # 6 vértices: cabelo alto, testa/sobrancelha escura baixa, nuca abaixo dos olhos, orelha, olho, pescoço
    n = 6
    uv = np.array([[0.5, 40 / size]] * n)  # todos "caem" na faixa escura da textura
    pos = np.zeros((n, 3))
    pos[:, 2] = np.array([0.08, 0.08, -0.08, 0.0, 0.0, 0.0])
    pos[:, 1] = np.array([0.10, 0.03, -0.02, 0.10, 0.10, 0.10])  # y_eye = 0.0
    masks = {
        "left_ear": [3],
        "right_ear": [3],
        "left_eyeball": [4],
        "right_eyeball": [4],
        "neck": [5],
    }
    w, color = hair.hair_weights(tex, uv, pos, masks, head_rows=0.85, y_eye=0.0)
    assert w[0] == 1.0  # topo da cabeça, à frente: cabelo
    assert w[1] == 0.0  # testa/sobrancelha (abaixo de y_eye + 5 cm, à frente) não vira fio
    assert w[3] == w[4] == w[5] == 0.0  # orelha, olho e pescoço ficam de fora
    assert color.startswith("#") and len(color) == 7


def test_suavizar_na_malha_tira_degraus_e_preserva_a_media():
    from app.face.hair import smooth_on_mesh

    # tira de triângulos: 0..5 em fila; só os dois primeiros vértices têm cabelo
    faces = np.array([[0, 1, 2], [1, 2, 3], [2, 3, 4], [3, 4, 5]])
    w = np.array([1.0, 1.0, 0.0, 0.0, 0.0, 0.0])
    s = smooth_on_mesh(w, faces, iterations=3)
    assert s[0] > s[2] > s[4] > s[5] >= 0  # degradê contínuo, sem salto de 1 para 0
    assert np.all((s >= 0) & (s <= 1))
    flat = smooth_on_mesh(np.ones(6), faces, iterations=3)
    assert np.allclose(flat, 1.0)  # área toda coberta continua toda coberta
