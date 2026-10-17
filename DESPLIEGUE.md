# Despliegue de Sazora en una VM privada

Guía para instalar Sazora en una máquina Linux (por ejemplo, una VM de Oracle Cloud) cerrada a internet, a la que solo acceden tus dispositivos. Está escrita para Ubuntu/Debian; en Oracle Linux cambia `apt` por `dnf`.

```
Móvil / ordenador ──HTTPS (red privada)──▶ proxy HTTPS ──▶ Sazora (127.0.0.1:8787) ──▶ Gemini (salida)
                                                                │
                                                       /var/lib/sazora (BD + PDF)
```

- **Entrada:** solo por la red privada. Ningún puerto abierto a internet.
- **Salida:** la VM llama a la API de Gemini al importar PDF. Es una conexión saliente (como `apt update`), permitida por defecto en Oracle.

## 1. Requisitos en la VM

```bash
sudo apt update && sudo apt install -y git curl
# Node.js 22 LTS (22.12 o superior)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

## 2. Instalar la aplicación

```bash
sudo useradd --system --home /var/lib/sazora --shell /usr/sbin/nologin sazora
sudo mkdir -p /opt/sazora /var/lib/sazora /etc/sazora
sudo chown sazora:sazora /var/lib/sazora && sudo chmod 700 /var/lib/sazora

sudo git clone https://github.com/JorgeSM18/Sazora.git /opt/sazora
cd /opt/sazora
sudo npm ci
sudo npm run build
```

## 3. Configuración y secretos

```bash
sudo cp /opt/sazora/.env.example /etc/sazora/sazora.env
sudo nano /etc/sazora/sazora.env
sudo chown root:sazora /etc/sazora/sazora.env && sudo chmod 640 /etc/sazora/sazora.env
```

Rellena al menos:

```ini
GEMINI_API_KEY=tu-clave
COOKIE_SECURE=1
# Opcional: para que alguien cree su cuenta desde la app con un código de invitación.
SAZORA_CODIGO_REGISTRO=un-codigo-largo-y-dificil
```

Deja `HOST` vacío: el servidor escucha solo en `127.0.0.1` y el proxy HTTPS es lo único que lo expone.

## 4. Servicio y copias de seguridad

```bash
sudo cp /opt/sazora/deploy/sazora.service /opt/sazora/deploy/sazora-copia.service /opt/sazora/deploy/sazora-copia.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sazora sazora-copia.timer
systemctl status sazora
journalctl -u sazora -f      # registros (Ctrl+C para salir)
```

## 5. Usuarios

Con el servicio en marcha, desde la VM:

```bash
cd /opt/sazora
sudo -u sazora env SAZORA_DATA_DIR=/var/lib/sazora npm run usuario -- crear jorge "Jorge"
sudo -u sazora env SAZORA_DATA_DIR=/var/lib/sazora npm run usuario -- listar
```

Si configuraste `SAZORA_CODIGO_REGISTRO`, la otra persona puede crear su cuenta desde la pantalla de acceso (*Crear cuenta*) con ese código. Cuando estéis los dos, puedes quitar el código y reiniciar (`sudo systemctl restart sazora`) para cerrar el registro.

## 6. HTTPS dentro de la red privada

Hace falta HTTPS para que el móvil instale la app y para que la cookie de sesión viaje cifrada. Elige una opción:

### A. Tailscale (recomendada si ya lo usas)

Los dispositivos de tu tailnet llegan a la VM y Tailscale da un certificado válido para su nombre `*.ts.net`, sin instalar nada más en los móviles (también en iPhone).

```bash
# En la VM, con Tailscale instalado y "HTTPS Certificates" activado en la consola de Tailscale:
sudo tailscale serve --bg --https=443 http://127.0.0.1:8787
tailscale serve status       # muestra la dirección https://<vm>.<tailnet>.ts.net
```

### B. Dominio propio con Caddy (reto DNS)

Si tienes un dominio, Caddy puede obtener un certificado real por reto DNS sin abrir puertos a internet. Necesita el módulo DNS de tu proveedor; consulta la documentación de Caddy para tu proveedor. La configuración base está en [`deploy/Caddyfile`](deploy/Caddyfile).

### C. Sin dominio: CA propia de Caddy

Con `tls internal` en el `Caddyfile`, Caddy crea su propia autoridad de certificación. Funciona, pero hay que instalar y marcar como de confianza su certificado raíz en cada móvil (en iPhone: Ajustes → General → Información → Ajustes de confianza de certificados).

En las opciones B y C, el proxy envía `X-Forwarded-Proto: https`; mantén igualmente `COOKIE_SECURE=1`.

La lista de la compra usa conexiones abiertas (*Server-Sent Events*) para los cambios en directo. Tailscale y Caddy las soportan sin configuración extra; si usas otro proxy, desactiva su búfer para `text/event-stream`.

## 7. Instalar la app en el móvil

- **Android (Chrome):** abre la dirección HTTPS → menú ⋮ → *Instalar aplicación*.
- **iPhone (Safari):** abre la dirección HTTPS → botón Compartir → *Añadir a pantalla de inicio*.

## 8. Actualizar

```bash
cd /opt/sazora
sudo git pull
sudo npm ci
sudo npm run build
sudo systemctl restart sazora
```

## 9. Copias de seguridad

- **Automática:** `sazora-copia.timer` hace cada día a las 4:00 una copia coherente de la base de datos en `/var/lib/sazora/copias/` y conserva las últimas 14 (`SAZORA_COPIAS`).
- **Manual:** `sudo systemctl start sazora-copia`.
- **Fuera de la VM:** copia periódicamente `/var/lib/sazora/copias/` y `/var/lib/sazora/documentos/` (los PDF) a otro sitio. Una copia que vive en la misma VM no te protege si la VM se pierde.
- **Restaurar:** para el servicio, sustituye `/var/lib/sazora/sazora.db` por la copia (y borra `sazora.db-wal` y `sazora.db-shm` si existen), ajusta el propietario a `sazora` y vuelve a arrancar.

## Notas de seguridad

- El servidor solo escucha en `127.0.0.1`; el único acceso es el proxy HTTPS de la red privada.
- El servicio corre con un usuario sin privilegios y con escritura solo en `/var/lib/sazora`.
- `/etc/sazora/sazora.env` contiene la clave de Gemini: solo la leen root y el servicio.
- Detrás del proxy todas las peticiones llegan desde `127.0.0.1`, así que el límite de intentos fallidos se aplica por usuario (login) y de forma global (registro con código).
- Mantén el sistema y Node actualizados (`sudo apt upgrade`).
