# MyoKi: evaluación para regresión EMG → movimiento continuo

Verificación: 18 de septiembre de 2026. Se consultaron fuentes primarias y la API pública; no se descargaron las señales completas ni se ejecutó código del repositorio.

**Dictamen:** candidato prioritario cuando importa que la referencia proceda de un guante y que el movimiento incluya tareas cotidianas. No satisface por sí solo la medición independiente de las quince flexiones del simulador ni demuestra transferencia directa al brazalete EMG PRO.

## Evidencia del descriptor

| Aspecto | Dato confirmado |
|---|---|
| Captura | Mano y brazo derechos; EMG y cinemática ipsilaterales. |
| EMG | Delsys: ocho Trigno Avanti y un Quattro; doce canales, ocho en antebrazo. Seis forman un anillo, dos están distales; cuatro cubren brazo/hombro. |
| Muestreo EMG | 1259 Hz nativos, elevación interna a 2000 Hz; voltios, sin prefiltrado. |
| Guante | CyberGlove, dieciocho sensores; aproximadamente 80,85 Hz. |
| Salidas | `glove`: valores arbitrarios de ocho bits; `glove_calibrated`: grados. |
| Calibración | Referencia de una mujer/un hombre para los demás participantes. Muñeca: extremos individuales mapeados a amplitudes bibliográficas. Los autores reconocen aproximación angular. |
| Sincronía | Marcas temporales comunes; retención del último valor hasta 2000 Hz. Prueba puntual: EMG→movimiento 14,89 ms; no equivale a error garantizado para todas las muestras. |
| Protocolo | Tareas fijadas, ejecución flexible; manipulación, escritura, tecleo, movimientos individuales y muñeca. |
| Advertencias | Información individual documenta repeticiones ausentes y sensores sueltos. No se verificó duración total. |

Fuente: [descriptor original, Scientific Data, 2025](https://doi.org/10.1038/s41597-025-05852-6), especialmente métodos y registros; [PDF institucional DLR](https://elib.dlr.de/221692/1/s41597-025-05852-6.pdf).

## Qué significa que existan dieciocho sensores

El CyberGlove de dieciocho sensores no mide directamente las DIP de índice, medio, anular y meñique. Incluye MCP/PIP, movimientos del pulgar, separaciones entre dedos, arco palmar y muñeca. El modelo de veintidós sensores agrega las cuatro DIP. Por tanto, **dieciocho canales no son dieciocho flexiones independientes de dedos**. Si se añaden DIP por una relación matemática para animar la mano, deben etiquetarse como estimaciones, no como verdad medida. [Estudio experimental sobre los dos modelos y su ajuste](https://pmc.ncbi.nlm.nih.gov/articles/PMC9145331/).

La investigación posterior con MyoKi identifica MCP de los cuatro dedos largos en canales 5, 7, 10 y 13; PIP en 6, 8, 11 y 14; MCP/IP del pulgar en 2 y 3; separaciones en 9, 12 y 15; arco palmar en 16 y flexión de muñeca en 17. Usó regresión continua LSTM y datos sin calibración, con validación por repeticiones. Los resultados agregados no acreditan precisión angular exacta ni generalización a otro sensor. [Seguimiento experimental de 2026](https://doi.org/10.1038/s41598-026-59979-6).

## Acceso y tamaño verificados

El [registro Figshare](https://doi.org/10.6084/m9.figshare.28696778.v1) describe 35 participantes, 74 tareas y seis repeticiones. Los participantes P26–P35 incluyen además 24 canales FMG. Acceso público y licencia **CC BY 4.0**, confirmados en la [API oficial](https://api.figshare.com/v2/articles/28696778).

La suma calculada a partir de los tamaños declarados en la API es:

| Archivos | Tamaño decimal |
|---|---:|
| P01.mat–P35.mat | 143,51 GB |
| Registro completo, incluido material adicional | 145,46 GB |
| Un participante | 3,16–4,95 GB |

También contiene `Participant_information.xlsx`, `Task_categorization.xlsx`, `Glove_calibration.xlsx`, `Synchronicity_test.mat`, `NinaproDB7_replica.mat` y archivos de comparación. El inventario y las URL individuales quedaron guardados en `myoki_figshare_metadata.json`.

El [repositorio de los autores](https://github.com/ASM-FAU/Multimodal-Bracelet) publica CAD, PCB y código de adquisición del brazalete multimodal. Esto no permite afirmar que incluya un pipeline completo de entrenamiento MyoKi en TensorFlow/PyTorch; no se verificó tal pipeline. El `Database_comparison.py` del registro es material de comparación, no evidencia suficiente de entrenamiento reproducible.

## Propuesta para la tesis — criterio técnico propio

1. Empezar con uno o dos participantes y examinar sus incidencias antes de descargar 143 GB.
2. Construir primero un modelo con los ocho canales de antebrazo y únicamente los ángulos que el guante realmente mide. Compararlo con seis canales del anillo; los ocho del dataset no reproducen la distribución de ocho electrodos en un único brazalete.
3. Separar participantes o repeticiones antes de generar ventanas. Ajustar normalización sólo en entrenamiento. Evitar ventanas compartidas entre conjuntos y filtros que usen muestras futuras al evaluar funcionamiento en tiempo real.
4. Mantener separados grados calibrados y lecturas normalizadas. Medir MAE por articulación cuando las unidades sean grados y reportar también desfase y latencia.
5. Para el simulador, usar un adaptador explícito de articulaciones. No copiar las primeras quince columnas a los quince ejes de flexión: contienen abducciones y omiten DIP.
6. Evaluar finalmente con grabaciones propias de EMG PRO y una referencia sincronizada. Igualar ocho canales por software no iguala posiciones, ancho de banda, ganancia ni contacto de los electrodos.

Frente a EMG-FK ya disponible localmente, MyoKi sirve especialmente como contraste de referencia obtenida con guante. Conviene conservar EMG-FK como evaluación complementaria: cambiar de dataset también cambia sensores, movimientos y población, de modo que una mejora no podría atribuirse únicamente al guante.
