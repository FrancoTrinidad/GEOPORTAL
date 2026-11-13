<?php

require __DIR__ . '/conect.php';

$version = $pdo->query('SELECT version()')->fetchColumn();
echo "Conexión exitosa\n$version\n";