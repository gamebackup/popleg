items_info=<?php

$cats = explode('|', $_POST['cats'] ?? '');
$json = [ ];

const STORE_CARDS = [
    [
        'id' => '3081', // Haunted House
        'price' => '0'
    ],
    [
        'id' => '3100', // Dr. Hare's Secret Lab
        'price' => '0'
    ],
    [
        'id' => '3109', // Don't be an Energy Hog
        'price' => '0'
    ],
    [
        'id' => '3223', // Blimp Adventure
        'price' => '0'
    ],
    [
        'id' => '3244', // Legendary Swords
        'price' => '0'
    ],
    /*[
        'id' => '3346', // Poptropica Labs
        'price' => '0'
    ],*/
    [
        'id' => '3020', // Colorizer
        'price' => '0'
    ],
    [
        'id' => '3057', // Costume Collector
        'price' => '0'
    ],
    [
        'id' => '3022', // Electrify
        'price' => '0'
    ],
    [
        'id' => '3050', // Torch
        'price' => '0'
    ],
    [
        'id' => '3070', // Minimizer
        'price' => '0'
    ],
    [
        'id' => '3071', // Bobblehead
        'price' => '0'
    ]
];

for($i = 0; $i < count($cats); $i++)
    $json[urlencode($cats[$i])] = $cats[$i] === '2001' ? STORE_CARDS : [ ];

echo json_encode($json);