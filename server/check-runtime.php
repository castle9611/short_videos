<?php
foreach (['curl','pdo_sqlite','mbstring','openssl'] as $extension) {
    if (!extension_loaded($extension)) {
        fwrite(STDERR, "Missing PHP extension: $extension\n");
        exit(1);
    }
}
