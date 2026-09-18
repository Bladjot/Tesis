# sEMG-MANUS: candidato de ocho canales con guante

Revisión: 18 de septiembre de 2026. Dictamen: **primera opción para un piloto cercano al formato del brazalete del usuario**, condicionado a verificar la interpretación angular y la temporización. No es una certificación de exactitud anatómica.

## Publicación y acceso

Publicado el 27 de marzo de 2026 por Max Graf y Mathieu Barthet (QMUL). Combina Myo de ocho canales con MANUS Quantum Metaglove. Los CSV contienen 42 columnas: 8 EMG, 10 IMU, 20 salidas articulares y 4 componentes de orientación. Publica 18 participantes; recomienda 15 completos, con 3 sesiones y 22 tareas a tres velocidades. Incluye flexión/extensión, separaciones, pulsaciones y una condición musical. Se publican 3.108 CSV; 2.969 pertenecen a la cohorte principal. Los sujetos 1, 2 y 17 están incompletos; hay otras tres anomalías de cantidad de ensayos documentadas. Es una publicación apoyada en una tesis; no se confirmó un descriptor específico revisado por pares. [Registro y codebook oficiales](https://zenodo.org/records/19261324).

Acceso directo sin cuenta, licencia CC BY 4.0. ZIP: **594.438.686 bytes**, unos 594,4 MB decimales. Se guardaron los metadatos y textos pequeños del depósito en `fuentes/`. [API del depósito](https://zenodo.org/api/records/19261324), [licencia](https://zenodo.org/records/19261324/files/LICENSE-data-CC-BY-4.0.txt).

## Qué se verificó en el código

El programa actual declara `MYO_SR=200`. Captura Myo con `emg_mode.FILTERED`, añade tiempos de recepción y, para cada EMG, selecciona el registro de guante con tiempo más próximo. Después elimina los timestamps al guardar el CSV. Los desfases se imprimen, pero no aparecen como columnas. Por tanto, **200 Hz es nominal para las filas EMG; no representa 200 medidas independientes del guante ni acredita un error de sincronización**. El programa consultado es el actual; no se certificó que sea exactamente la versión empleada para los ensayos de 2024. [Constantes](https://github.com/maxgraf96/sEMG-manus-manager/blob/main/constants.py), [captura Myo](https://github.com/maxgraf96/sEMG-manus-manager/blob/main/myo/worker_myo.py), [emparejamiento y exportación](https://github.com/maxgraf96/sEMG-manus-manager/blob/main/components/gesture_detail.py).

## Medición del guante y articulaciones

El Quantum mide posiciones de las puntas mediante sensores electromagnéticos; su modelo biomecánico reconstruye el esqueleto. El fabricante anuncia 120 Hz para sus sensores, pero esto no demuestra esa frecuencia efectiva en el dataset. **Las veinte salidas no son veinte goniómetros independientes.** [Ficha del Quantum](https://www.manus-meta.com/products/quantum-metagloves), [ficha técnica y solver](https://assets.website-files.com/61de97d15a7bb6441d9565c0/6273d838a21ca5c32455ad4b_Datasheet%20-%20Manus%20Quantum%20Metagloves.pdf).

MANUS documenta sus salidas de ergonomía en grados. Para el pulgar el orden anatómico es CMC separación, CMC flexión radial, MCP flexión, IP flexión. El CSV usa nombres genéricos `thumb_spread`, `thumb_mcp`, `thumb_pip`, `thumb_dip`; **no debe interpretarse que el pulgar tiene PIP y DIP**. La equivalencia con ese orden es una hipótesis respaldada por el esquema del SDK, pendiente de confirmar contra la versión del exportador MANUS utilizada. El codebook remite al software para unidades y no publica una validación individual completa. [Semántica oficial de ergonomía](https://docs.manus-meta.com/3.2.0/Software/Rec/Ergonomics/), [receptor de los veinte valores](https://github.com/maxgraf96/sEMG-manus-manager/blob/main/manus/worker_manus.py).

## Auditoría propia de una grabación

Se leyó `data/u_3/s_1/g_flexext_fist/recording_medium_27_03_2024_16_25_09.csv` mediante HTTP Range: **574.376 bytes transferidos**, sin descargar el ZIP completo. `zipfile` comprobó su CRC. Resultado: 2.020 filas × 42 columnas, sin NaN ni infinito. Los canales articulares cambian durante el ensayo; las salidas están en magnitudes compatibles con grados. El índice MCP va aproximadamente de −37,4 a 76,8; no debe asumirse que toda salida está limitada a 0–90.

El 69,1% de los pares de filas adyacentes repite exactamente las veinte salidas del guante. Esto confirma que no todas las filas EMG aportan una postura nueva; **no permite deducir por sí solo la frecuencia real del guante ni diagnosticar pérdidas**, porque puede haber retención, repetición o periodos estables. No hay timestamps conservados para resolverlo. Estos resultados describen una sola grabación, no toda la base.

Evidencia local: `auditar_manus_muestra.py`, `manus_sample_audit.json` y `fuentes/manus_muestra_flexext_fist.csv`. La copia conserva el contenido original; debe citarse a Graf y Barthet y la licencia CC BY 4.0 al reutilizarla.

## Decisión para el proyecto

Usaría ocho EMG como entrada y ángulos continuos como salida. Los nombres de gesto sirven para organizar los ensayos, no obligan a clasificar. Mantendría separados sujetos y sesiones al evaluar; primero probaría tareas lentas y después rápidas. Antes de afirmar error en grados, cerraría unidades, ejes, pulgar y calibración. Haría la primera comparación con DB5+DB9 para contrastar dos métodos de referencia y dos protocolos; sus errores no deben compararse como si ambos midieran exactamente lo mismo.

El Myo del dataset y el EMG PRO del usuario son dispositivos diferentes. Ocho canales coincidentes sólo facilitan las dimensiones de entrada; no garantizan igual posición, filtrado, escala, frecuencia o capacidad de generalizar sin datos propios.
