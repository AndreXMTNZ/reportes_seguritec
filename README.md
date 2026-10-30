# SEGURITEC · Control de visitas técnicas (sin login)

Aplicación para GitHub Pages con **Firebase Realtime Database**, fotografías/cotizaciones en **Cloud Storage for Firebase** y reportes imprimibles como PDF. El formulario se abre directamente, sin usuario ni contraseña.

**Advertencia de seguridad:** esta versión está diseñada para pruebas con **datos no confidenciales**. La autenticación anónima se ejecuta de manera automática y **NO** identifica ni autoriza a miembros del personal. Cualquier persona que entre a la aplicación (o que replique las peticiones Firebase con sus parámetros públicos) puede crear una cuenta anónima, leer, modificar y borrar información. No permite guardar documentos privados de clientes de forma segura. Para uso real con datos de clientes se necesita control de acceso (roles, cuentas, backend seguro, etc.). **No confundas `auth != null` con protección de datos en un sitio que permite acceso anónimo público**.

## Archivos

- `index.html`: interfaz y campos de visitas técnicas.
- `styles.css`: diseño adaptable y formato de impresión PDF.
- `app.js`: formularios, historial, conexión en tiempo real, carga de archivos, reportes y respaldo JSON.
- `firebase-config.js`: configuración suministrada para `reportesseguritec`.
- `database.rules.json`: reglas para Realtime Database.
- `storage.rules`: reglas de almacenamiento de archivos.

## 1. Habilitar acceso anónimo en Firebase (sin cuentas ni formulario)

1. Ve a <https://console.firebase.google.com/> y selecciona el proyecto `reportesseguritec`.
2. Abre **Authentication > Sign-in method**.
3. Activa el proveedor **Anonymous / Anónimo**. No actives Email/Password si no lo necesitas.
4. En **Authentication > Settings > Authorized domains**, agrega **solo el dominio** de GitHub Pages (`TU-USUARIO.github.io`). No agregues `https://` ni `/seguritec-visitas/`.
5. Cuando una persona visite la web, Firebase iniciará automáticamente una sesión anónima, sin mostrar pantalla ni solicitar credenciales.

## 2. Realtime Database (necesario)

1. Entra en **Realtime Database** y comprueba que sea `https://reportesseguritec-default-rtdb.firebaseio.com`.
2. Abre **Rules**, sustituye las reglas por el texto de `database.rules.json` y pulsa **Publish**.
3. Las visitas se guardarán debajo de `visits/ID_DE_VISITA`.
4. Las reglas requieren una sesión Firebase, pero **no** restringen los datos a técnicos autorizados; cualquier visitante obtiene la suya en segundo plano.

## 3. Archivos: Firebase Storage (necesario para subir fotos y cotizaciones)

1. Abre **Storage** en Firebase Console. Si no hay bucket, créalo.
2. **Cloud Storage for Firebase requiere plan Blaze** a partir de febrero de 2026. Hay cuotas de uso sin cargo, pero el plan requiere facturación; configura presupuesto y alertas en Google Cloud. Si no habilitas Storage, se pueden guardar visitas **sin nuevos archivos**, pero fallará la subida de fotografías/documentos.
3. Comprueba el bucket `reportesseguritec.firebasestorage.app`.
4. En **Storage > Rules**, copia y publica `storage.rules`.
5. Las fotografías se optimizan a JPG en el navegador (máximo 10). Se admiten hasta 8 documentos, máximo 10 MB cada uno y 25 MB en total por visita.
6. Storage guarda los archivos; la RTDB guarda sus rutas y metadatos. Los enlaces de descarga de Firebase Storage incluyen tokens compartibles, por lo que **no son privados**.

## 4. Publicar en GitHub Pages

1. Descomprime el ZIP que contiene estos archivos.
2. Abre <https://github.com/new> y crea `seguritec-visitas`. Para GitHub Free, Pages normalmente exige que el repositorio sea público.
3. En **Add file > Upload files**, sube **los archivos que están dentro** de la carpeta, sin meter la carpeta contenedora. Debe existir `index.html` en la raíz.
4. Haz commit.
5. En **Settings > Pages > Build and deployment**, selecciona **Deploy from a branch**, rama `main`, carpeta `/(root)` y guarda.
6. Tu URL tendrá el formato `https://TU-USUARIO.github.io/seguritec-visitas/`.
7. Asegúrate de que `TU-USUARIO.github.io` esté incluido en dominios autorizados de Firebase Authentication.
8. Abre la URL publicada y comprueba que el indicador diga **Conectado**.

## 5. Probar

1. Abre la web: deberías ver directamente la pantalla de SEGURITEC.
2. Introduce cliente, proyecto, técnico, fecha y trabajo realizado.
3. Agrega al menos un equipo revisado; indica cantidad, unidad y costos si aplica.
4. Indica nombre y cargo de la persona que recibió el mantenimiento.
5. Opcionalmente adjunta una fotografía y una cotización.
6. Pulsa **Guardar visita**; los registros se sincronizan en RTDB y los archivos en Storage.
7. Desde otro dispositivo abre el mismo enlace y comprueba que aparece el historial.
8. Haz clic en **PDF**. En el diálogo del navegador, elige **Guardar como PDF**.
9. Al abrir una visita, puedes abrir/descargar los documentos guardados y editar la información.

**El reporte PDF** muestra nombres de adjuntos, pero no incrusta los PDFs o documentos Word adjuntos; esos archivos se envían por separado.

## 6. Límites, riesgos y respaldo

- Requiere conexión a internet para confirmar nuevos registros y subir archivos; no tiene modo de trabajo sin conexión garantizado.
- Todos los visitantes con acceso al sitio pueden consultar, editar o borrar visitas. No usar información reservada en esta versión.
- Las reglas limitan formatos/tamaños de archivos, pero no pueden limitar quién puede operar al permitir acceso anónimo público.
- El JSON de respaldo incluye datos y *referencias* de archivos, no su contenido binario. Para backup integral también respalda el bucket Storage.
- Los documentos pueden seguir accesibles si alguien conserva una URL de descarga tokenizada, aun después de restringir reglas; gestiona esos enlaces con cuidado.
- Al editar el sitio en GitHub, no compartas claves de servicio, credenciales privadas, cuentas de administrador ni secretos de servidor. La `apiKey` web de Firebase es un identificador público de cliente, no una clave de administrador.

**Documentación oficial:** https://firebase.google.com/docs/auth/web/anonymous-auth · https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024 · https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
