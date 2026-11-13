<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$lat = filter_input(INPUT_GET, 'lat', FILTER_VALIDATE_FLOAT);
$lon = filter_input(INPUT_GET, 'lon', FILTER_VALIDATE_FLOAT);
if (!is_float($lat) || !is_float($lon) || abs($lat) > 90 || abs($lon) > 180) {
    http_response_code(400);
    echo '{"error":"Coordenadas inválidas."}';
    exit;
}

try {
    require_once __DIR__ . '/conect.php';

    $consulta = $pdo->prepare('
        WITH origen AS (
            SELECT ST_MakePoint(:lon, :lat, 4326)::geography AS punto
        )
        SELECT id, nombre, ROUND(ST_Distance(geom::geography, punto))::integer AS metros
        FROM geoportal.talleres_demo CROSS JOIN origen
        WHERE ST_DWithin(geom::geography, punto, 500)
        ORDER BY ST_Distance(geom::geography, punto), id
    ');
    $consulta->execute(['lon' => $lon, 'lat' => $lat]);
    echo json_encode($consulta->fetchAll(PDO::FETCH_ASSOC), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    error_log('Geoportal: ' . $error->getMessage());
    http_response_code(500);
    echo '{"error":"No se pudo consultar la cercanía de los talleres."}';
}
