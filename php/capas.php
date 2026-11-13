<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');



try {
    require_once __DIR__ . '/conect.php';

    $filas = $pdo->query('SELECT capa, geojson FROM geoportal.capas_geojson');
    $capas = [];
    foreach ($filas as $fila) {
        $capas[$fila['capa']] = json_decode($fila['geojson'], true, 512, JSON_THROW_ON_ERROR);
    }

    echo json_encode((object) $capas, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    error_log('Geoportal: ' . $error->getMessage());
    http_response_code(500);
    echo '{"error":"No se pudieron consultar las capas. Revisa la terminal de PHP."}';
}
