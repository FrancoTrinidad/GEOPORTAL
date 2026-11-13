<?php

$host = '127.0.0.1';
$puerto = 5432;
$baseDeDatos = 'GasolineriaPortal';
$usuario = 'postgres';
$contrasena = '';

$dsn = "pgsql:host=$host;port=$puerto;dbname=$baseDeDatos";

$pdo = new PDO($dsn, $usuario, $contrasena, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);