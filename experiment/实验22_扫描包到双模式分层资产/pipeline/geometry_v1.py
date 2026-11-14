"""Pinned local subset of experiment 9 source-face geometry helpers.

See SOURCE.md for the source revision and scope. Keeping these helpers local
prevents a later experiment 9 edit from silently changing instance proposals.
"""

import hashlib
import json

import numpy as np
import trimesh


def transform_hash(matrix):
    values = [int(n) if float(n).is_integer() else float(n) for n in matrix]
    return hashlib.sha256(json.dumps(values, separators=(",", ":")).encode()).hexdigest()


def transform_points(points, matrix):
    return np.asarray(points) @ matrix[:3, :3].T + matrix[:3, 3]


def local_coordinates(points, item):
    delta = np.asarray(points) - item["center"]
    c, s = np.cos(item["rotY"]), np.sin(item["rotY"])
    return np.column_stack((c * delta[:, 0] - s * delta[:, 2], delta[:, 1],
                            s * delta[:, 0] + c * delta[:, 2]))


def in_polygon(points, polygon):
    points = np.atleast_2d(points)
    x, z = points[:, 0], points[:, 1]
    inside = np.zeros(len(points), dtype=bool)
    for i, a in enumerate(polygon):
        b = polygon[i - 1]
        hit = ((a[1] > z) != (b[1] > z)) & (x < (b[0] - a[0]) * (z - a[1]) /
                                                          (b[1] - a[1] + 1e-30) + a[0])
        inside ^= hit
    return inside


def wall_coordinates(points, wall):
    delta = np.asarray(points) - np.asarray(wall["origin"])
    return delta @ np.asarray(wall["u"]), delta[:, 1], delta @ np.asarray(wall["n"])


def in_openings(u, y, wall, pad=0):
    result = np.zeros(np.shape(u), dtype=bool)
    for opening in wall.get("openings", []):
        result |= ((u > opening["u0"] - pad) & (u < opening["u1"] + pad) &
                   (y > opening["v0"] - pad) & (y < opening["v1"] + pad))
    return result


def structure_assignment(centers, normals, room, distance=0.03):
    result = np.zeros(len(centers), dtype=bool)
    horizontal = np.abs(normals[:, 1]) > 0.8
    footprint = in_polygon(centers[:, [0, 2]], room["polygon"])
    result |= horizontal & (np.abs(centers[:, 1]) <= distance) & footprint
    height = max(w["height"] for w in room["walls"])
    result |= horizontal & (np.abs(centers[:, 1] - height) <= distance) & footprint
    for wall in room["walls"]:
        u, y, d = wall_coordinates(centers, wall)
        result |= ((np.abs(d) <= distance) & (u >= 0) & (u <= wall["length"]) &
                   (y >= 0) & (y <= wall["height"]) & ~in_openings(u, y, wall) &
                   (np.abs(normals @ np.asarray(wall["n"])) > 0.8))
    return result


def components_for_faces(faces, ids):
    if not len(ids):
        return []
    # Shared original PLY edge; never join faces by mere spatial proximity.
    edges = np.sort(faces[ids][:, [[0, 1], [1, 2], [2, 0]]].reshape(-1, 2), axis=1)
    owner = np.repeat(np.arange(len(ids)), 3)
    order = np.lexsort((edges[:, 1], edges[:, 0]))
    ordered = edges[order]
    pairs = np.flatnonzero(np.all(ordered[1:] == ordered[:-1], axis=1))
    adjacency = np.column_stack((owner[order[pairs]], owner[order[pairs + 1]]))
    return [ids[np.asarray(component)] for component in
            trimesh.graph.connected_components(adjacency, nodes=np.arange(len(ids)))]
