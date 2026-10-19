# Despliegue de Sazora en Oracle Cloud con Tailscale

Guía para instalar Sazora en una VM de Oracle Cloud (Always Free) sin ningún puerto abierto a internet. Solo se entra desde los dispositivos de tu red de Tailscale, por `https://sazora.<tu-tailnet>.ts.net`, con un certificado válido y la app instalable en el móvil.

```
Móvil / PC (Tailscale activo)
        │  HTTPS, solo dentro de la tailnet
        ▼
tailscale serve :443 ──▶ Sazora 127.0.0.1:8787 ──▶ API de Gemini (solo salida)
                                │
                     /var/lib/sazora  (base de datos + PDF)
```

- **Entrada:** solo por Tailscale. La VM no acepta conexiones desde internet.
- **Salida:** la VM llama a la API de Gemini al importar PDF y al buscar datos nutricionales.

Cambia `<tu-tailnet>`, `<tu-usuario>` y los demás marcadores por tus valores. Cada bloque dice dónde se ejecuta: **en tu PC** o **en la VM** (por SSH).

---

## 0. Antes de empezar (en tu PC)

### 0.1 El código, subido a GitHub

La VM descarga el código del repositorio: todo lo que quieras desplegar tiene que estar con commit y push en `main`.

### 0.2 Copia de tus datos actuales (opcional)

Si ya usas Sazora en local y quieres llevarte la pauta, alimentos, recetas, plan y PDF sin volver a importarlos, haz una copia coherente (se puede hacer con el servidor en marcha). En tu PC, en la carpeta del proyecto:

```
npm run copia
```

Apunta el archivo que crea (`server-data/copias/sazora-AAAAMMDD-HHMMSS.db`). Los PDF están en `server-data/documentos/`.

### 0.3 Lo que necesitas

- Cuenta de **Oracle Cloud** (Free Tier).
- Cuenta de **Tailscale**, con la app instalada en tu PC y en los móviles que vayan a usar Sazora.
- **Clave de la API de Gemini** ([Google AI Studio](https://aistudio.google.com/apikey)). Recomendado: activar la facturación. Con el nivel gratuito la cuota diaria se agota enseguida y Google puede usar el contenido enviado, y los PDF de la pauta son datos de salud.

---

## 1. Crear la VM en Oracle Cloud

1. Consola de Oracle → **Compute → Instances → Create instance**.
2. **Name:** `sazora`.
3. **Image:** *Canonical Ubuntu 24.04* (usuario por defecto: `ubuntu`).
4. **Shape:** *Ampere → VM.Standard.A1.Flex* con **1 OCPU y 6 GB**, dentro del Always Free.
   - *VM.Standard.E2.1.Micro* (1 GB) también es gratis, pero compilar puede quedarse sin memoria: si la usas, añade swap (paso 2.3).
   - Si sale *Out of capacity*, prueba otro *Availability Domain* o más tarde.
5. **Networking:** VCN nueva con subred pública e IP pública (solo para el primer SSH; después se cierra).
6. **Add SSH keys:** *Generate a key pair for me* y **descarga la clave privada**, por ejemplo en `~/.ssh/sazora.key`.
7. *Create* y copia la **Public IP address** cuando esté en *Running*.

> ⚠️ **Instancias inactivas:** Oracle puede recuperar las instancias *Always Free* que pasan 7 días con muy poco uso de CPU, red y memoria, y Sazora usa muy poco. Para evitarlo, pasa la cuenta a *Pay As You Go* (Billing → Upgrade): no se cobra mientras te mantengas en los límites gratuitos. Crea una **alerta de presupuesto** (Billing → Budgets) para enterarte de cualquier cargo.

---

## 2. Primer acceso y preparación

### 2.1 SSH por la IP pública (solo esta vez)

En tu PC:

```
ssh -i ~/.ssh/sazora.key ubuntu@<IP-pública>
```

En Windows, si protesta por los permisos de la clave, deja solo a tu usuario en *Propiedades → Seguridad → Avanzado* (sin herencia).

### 2.2 Sistema al día y zona horaria

En la VM:

```
sudo apt update && sudo apt full-upgrade -y
sudo timedatectl set-timezone Europe/Madrid
sudo apt install -y git curl
sudo reboot
```

La zona horaria hace que la copia diaria de las 4:00 sea a tu hora.

### 2.3 Swap (solo en la VM de 1 GB)

```
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 3. Tailscale

### 3.1 Consola de Tailscale

En [login.tailscale.com/admin](https://login.tailscale.com/admin) → **DNS**:

- **MagicDNS:** activado.
- **HTTPS Certificates:** *Enable*. Sin esto no hay certificado `*.ts.net`.

### 3.2 Instalar en la VM

```
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=sazora
```

Abre el enlace que aparece y autoriza la máquina.

### 3.3 Que no caduque

Consola de Tailscale → **Machines → sazora → ⋯ → Disable key expiry**. Si no, la VM se desconecta sola a los 180 días. (Si etiquetas la VM como en el paso 13, no caduca y este paso sobra.)

### 3.4 Comprobar el acceso por Tailscale

En tu PC, con Tailscale activo:

```
ssh -i ~/.ssh/sazora.key ubuntu@sazora
```

### 3.5 Cerrar el SSH público

Solo **después** de que funcione el paso 3.4: Oracle → **Networking → Virtual Cloud Networks → tu VCN → Security Lists → Default Security List** → borra la regla *Ingress* de **TCP 22 desde 0.0.0.0/0**.

Desde ese momento la VM no acepta conexiones desde internet; Tailscale funciona igual porque solo usa conexiones salientes. Si Tailscale fallara en la VM, se puede entrar desde la consola web de Oracle (*Console connection* o *Cloud Shell*).

---

## 4. Node.js

En la VM:

```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
node -e "require('node:sqlite'); console.log('sqlite OK')"
```

Hace falta **Node 22.13 o superior** (`node:sqlite` sin opciones experimentales). NodeSource instala la última 22.

---

## 5. Usuario del servicio y carpetas

En la VM:

```
sudo useradd --system --home /var/lib/sazora --shell /usr/sbin/nologin sazora
sudo mkdir -p /opt/sazora /var/lib/sazora /etc/sazora
sudo chown sazora:sazora /var/lib/sazora
sudo chmod 700 /var/lib/sazora
```

| Carpeta | Contenido | Permisos |
|---|---|---|
| `/opt/sazora` | Código y web compilada | De root; el servicio solo lee |
| `/var/lib/sazora` | Base de datos, PDF y copias | Solo el usuario `sazora` |
| `/etc/sazora` | Configuración y clave de Gemini | root y el grupo `sazora` |

---

## 6. Descargar el código (repositorio privado)

### 6.1 Clave de despliegue de solo lectura

En la VM:

```
sudo ssh-keygen -t ed25519 -f /root/.ssh/sazora_deploy -N "" -C "sazora-vm"
sudo cat /root/.ssh/sazora_deploy.pub
```

En GitHub → repositorio → **Settings → Deploy keys → Add deploy key**: pega la línea `ssh-ed25519 …`, sin marcar *Allow write access*.

### 6.2 Clonar y compilar

En la VM:

```
sudo ssh-keyscan github.com | sudo tee -a /root/.ssh/known_hosts
sudo GIT_SSH_COMMAND="ssh -i /root/.ssh/sazora_deploy -o IdentitiesOnly=yes" git clone git@github.com:JorgeSM18/Sazora.git /opt/sazora
sudo git -C /opt/sazora config core.sshCommand "ssh -i /root/.ssh/sazora_deploy -o IdentitiesOnly=yes"
cd /opt/sazora
sudo npm ci
sudo npm run build
ls dist/index.html
```

`core.sshCommand` hace que los `git pull` posteriores usen la misma clave.

---

## 7. Configuración y secretos

Crea el archivo **desde cero** (no copies `.env.example`). En la VM:

```
sudo install -m 640 -o root -g sazora /dev/null /etc/sazora/sazora.env
sudo nano /etc/sazora/sazora.env
```

Contenido:

```ini
GEMINI_API_KEY=tu-clave-de-gemini
COOKIE_SECURE=1
# Opcional: para que alguien cree su cuenta desde la app (mínimo 12 caracteres).
# SAZORA_CODIGO_REGISTRO=un-codigo-largo-y-dificil
```

> ⚠️ **No pongas `SAZORA_DATA_DIR`, `HOST` ni `PORT`.** Los fija el servicio. systemd da prioridad a este archivo, y una línea vacía como `SAZORA_DATA_DIR=` (la que trae la plantilla) hace que el servidor intente escribir en `/opt/sazora/server-data`, que es de solo lectura, y no arranca.

---

## 8. Pasar tus datos (opcional)

Hazlo **antes** del primer arranque del servicio. Si empiezas de cero, salta al paso 9.

### 8.1 Copiar a la VM

En tu PC, en la carpeta del proyecto (con el nombre de la copia del paso 0.2):

```
scp -i ~/.ssh/sazora.key server-data/copias/sazora-AAAAMMDD-HHMMSS.db ubuntu@sazora:/tmp/sazora.db
```

```
scp -i ~/.ssh/sazora.key -r server-data/documentos ubuntu@sazora:/tmp/documentos
```

### 8.2 Colocar con los permisos correctos

En la VM:

```
sudo install -o sazora -g sazora -m 600 /tmp/sazora.db /var/lib/sazora/sazora.db
sudo cp -r /tmp/documentos /var/lib/sazora/
sudo chown -R sazora:sazora /var/lib/sazora/documentos
sudo chmod -R u=rwX,go= /var/lib/sazora/documentos
rm -rf /tmp/sazora.db /tmp/documentos
```

### 8.3 Revisar los usuarios de la copia

```
sudo -u sazora SAZORA_DATA_DIR=/var/lib/sazora node --no-warnings /opt/sazora/server/usuarios.mjs listar
```

Si la copia trae usuarios de prueba que no quieres en producción, bórralos. **Se borran también todos sus datos y no se puede deshacer**: comprueba antes cuál es cuál.

```
sudo -u sazora SAZORA_DATA_DIR=/var/lib/sazora node --no-warnings /opt/sazora/server/usuarios.mjs borrar <usuario>
```

Cambiar una contraseña:

```
sudo -u sazora SAZORA_DATA_DIR=/var/lib/sazora node --no-warnings /opt/sazora/server/usuarios.mjs clave <usuario>
```

---

## 9. Servicio y copias automáticas

En la VM:

```
sudo cp /opt/sazora/deploy/sazora.service /opt/sazora/deploy/sazora-copia.service /opt/sazora/deploy/sazora-copia.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sazora sazora-copia.timer
systemctl status sazora --no-pager
```

Debe decir **active (running)**. Registros (Ctrl+C para salir):

```
journalctl -u sazora -f
```

Comprobación local (401 es lo correcto: pide iniciar sesión):

```
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/api/sesion
```

---

## 10. Usuarios (si empiezas de cero)

En la VM (pide la contraseña sin mostrarla, mínimo 8 caracteres):

```
sudo -u sazora SAZORA_DATA_DIR=/var/lib/sazora node --no-warnings /opt/sazora/server/usuarios.mjs crear <tu-usuario> "<Tu nombre>"
```

Para otra persona: créale el usuario igual, o pon `SAZORA_CODIGO_REGISTRO` en `/etc/sazora/sazora.env`, reinicia (`sudo systemctl restart sazora`) y que cree su cuenta desde la pantalla de acceso con ese código. Después **quita el código y reinicia** para cerrar el registro.

---

## 11. HTTPS con Tailscale

En la VM:

```
sudo tailscale serve --bg --https=443 http://127.0.0.1:8787
tailscale serve status
```

`status` muestra la dirección: `https://sazora.<tu-tailnet>.ts.net`. La configuración se mantiene tras reiniciar.

> ⚠️ Usa `serve`, **nunca `funnel`**: `serve` solo es accesible dentro de tu tailnet; `funnel` publica la app en internet. `tailscale funnel status` no debe mostrar nada publicado.

`COOKIE_SECURE=1` es obligatorio: la app se sirve siempre por HTTPS.

---

## 12. Comprobar que funciona

Con Tailscale activo en el dispositivo:

1. Abre `https://sazora.<tu-tailnet>.ts.net` (la primera vez tarda unos segundos en emitir el certificado) e **inicia sesión**.
2. Desde un dispositivo **sin** Tailscale la dirección **no debe abrir**.
3. **Compra en directo:** con la lista abierta en dos dispositivos, un cambio en uno aparece al instante en el otro, con «En directo».
4. **Importar:** al subir un PDF, el paso («Paso 2 de 3…») avanza mientras Gemini lee. Si se queda en «Identificando el documento» y salta al final, el proxy está acumulando la respuesta.
5. **Copia manual:**

```
sudo systemctl start sazora-copia
sudo ls -l /var/lib/sazora/copias/
```

---

## 13. Restringir el acceso dentro de la tailnet (recomendado)

Por defecto, cualquier dispositivo de la tailnet llega a cualquier puerto de la VM. Con una política, la app (443) queda para los miembros y el SSH solo para el administrador.

1. Etiqueta la VM (en la VM). Las máquinas etiquetadas no caducan:

```
sudo tailscale up --hostname=sazora --advertise-tags=tag:sazora
```

2. Consola de Tailscale → **Access controls**. Añade a la política (sin quitar lo que necesites para otros dispositivos):

```json
"tagOwners": {
  "tag:sazora": ["autogroup:admin"]
},
"grants": [
  // La app: miembros de la tailnet, solo HTTPS
  { "src": ["autogroup:member"], "dst": ["tag:sazora"], "ip": ["tcp:443"] },
  // Administración por SSH: solo administradores
  { "src": ["autogroup:admin"],  "dst": ["tag:sazora"], "ip": ["tcp:22"] }
]
```

3. Usa **Preview rules** y guarda solo si sigues teniendo acceso. Si te equivocas, queda la consola web de Oracle.

---

## 14. Instalar la app en el móvil

- **Android (Chrome):** abre la dirección → menú ⋮ → *Instalar aplicación*.
- **iPhone (Safari):** abre la dirección → Compartir → *Añadir a pantalla de inicio*.

La app solo abre con Tailscale conectado:

- **iPhone:** app de Tailscale → activa **VPN On Demand**.
- **Android:** Ajustes → VPN → Tailscale → **VPN siempre activada**.

**Otra persona:** invítala a la tailnet (*Users → Invite users*; comprueba cuántos usuarios admite tu plan) o comparte solo la máquina (*Machines → sazora → Share*) y comprueba que la dirección le abre. Sus datos son independientes; solo compartís las listas de la compra que compartáis desde la app.

---

## 15. Actualizar

Con los cambios con commit y push en `main`. En la VM:

```
sudo systemctl start sazora-copia
cd /opt/sazora
sudo git pull
sudo npm ci
sudo npm run build
sudo systemctl restart sazora
systemctl status sazora --no-pager
```

Volver a la versión anterior si algo falla:

```
cd /opt/sazora
git log --oneline -5
sudo git checkout <commit-anterior>
sudo npm ci && sudo npm run build && sudo systemctl restart sazora
```

Para volver después a la última versión: `sudo git checkout main && sudo git pull`.

---

## 16. Copias de seguridad

- **Automática:** `sazora-copia.timer` hace cada día a las 4:00 una copia coherente de la base de datos en `/var/lib/sazora/copias/` y conserva las últimas 14 (`SAZORA_COPIAS`).
- **Manual:** `sudo systemctl start sazora-copia`.

### Fuera de la VM

Una copia dentro de la VM no protege si se pierde la VM. Bájate de vez en cuando las copias y los PDF. En tu PC, en **Git Bash** o cualquier shell tipo Unix (en PowerShell la redirección `>` corrompe los archivos binarios):

```bash
ssh -i ~/.ssh/sazora.key ubuntu@sazora 'sudo systemctl start sazora-copia && sudo tar -C /var/lib/sazora -czf - copias documentos' > "sazora-$(date +%F).tgz"
```

Contiene datos de salud: guárdalo en un sitio seguro. Se puede programar con el Programador de tareas de Windows (`bash.exe -c "<la orden>"`) o con `cron`.

### Restaurar

En la VM:

```
sudo systemctl stop sazora
sudo install -o sazora -g sazora -m 600 /var/lib/sazora/copias/sazora-AAAAMMDD-HHMMSS.db /var/lib/sazora/sazora.db
sudo rm -f /var/lib/sazora/sazora.db-wal /var/lib/sazora/sazora.db-shm
sudo systemctl start sazora
```

Si restauras también los PDF, descomprime `documentos/` en `/var/lib/sazora/` y aplica los permisos del paso 8.2.

---

## 17. Mantenimiento

- **Sistema:** Ubuntu instala solo las actualizaciones de seguridad. De vez en cuando: `sudo apt update && sudo apt full-upgrade -y` y `sudo reboot` si lo pide.
- **Node:** se actualiza con el sistema; después, `sudo systemctl restart sazora`.
- **Espacio:** `df -h /` y `sudo du -sh /var/lib/sazora`.
- **Registros:** `journalctl -u sazora --since "1 hour ago"`.

---

## Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| El servicio no arranca; `EROFS` o `server-data` en el registro | `SAZORA_DATA_DIR=` vacío en `/etc/sazora/sazora.env` | Borra esa línea y reinicia (paso 7) |
| `No such built-in module: node:sqlite` | Node demasiado antiguo | Paso 4 |
| La dirección `.ts.net` no carga | Tailscale apagado en el dispositivo o fuera de la tailnet | Activa Tailscale; comprueba el dispositivo en *Machines* |
| Error de certificado | HTTPS no activado en Tailscale | Paso 3.1 y repetir el 11 |
| La página da 502 | Sazora parado | `systemctl status sazora`, `journalctl -u sazora -n 50` |
| No se puede iniciar sesión tras migrar | Contraseña distinta | Paso 8.3, `clave <usuario>` |
| «Se ha agotado la cuota de Gemini» | Nivel gratuito agotado | Esperar o activar la facturación |
| `git pull` pide contraseña o falla | Falta la clave de despliegue | Paso 6 |
| La VM desaparece tras unas semanas | Recuperación de instancias inactivas de Oracle | Cuenta *Pay As You Go* (paso 1) |

---

## Alternativa sin Tailscale: Caddy

Si prefieres otra red privada, Caddy puede servir el HTTPS con la configuración de [`deploy/Caddyfile`](deploy/Caddyfile):

- **Dominio propio:** certificado real por reto DNS, sin abrir puertos a internet. Necesita el módulo DNS de tu proveedor (consulta la documentación de Caddy).
- **Sin dominio:** `tls internal` crea una autoridad de certificación propia. Hay que instalar su certificado raíz en cada móvil y marcarlo como de confianza (en iPhone: Ajustes → General → Información → Ajustes de confianza de certificados).

Caddy envía `X-Forwarded-Proto: https` y transmite sin búfer las respuestas que llegan por partes (la lista de la compra en directo y el avance de la importación). Mantén `COOKIE_SECURE=1`. Con otro proxy, desactiva su búfer para esas respuestas.

## Notas de seguridad

- El servidor solo escucha en `127.0.0.1`; el único acceso es el proxy HTTPS de la red privada.
- El servicio corre con un usuario sin privilegios y solo puede escribir en `/var/lib/sazora`.
- `/etc/sazora/sazora.env` contiene la clave de Gemini: solo la leen root y el servicio.
- Detrás del proxy todas las peticiones llegan desde `127.0.0.1`, así que el límite de intentos fallidos se aplica por usuario (login) y de forma global (registro con código).
- Cada usuario solo accede a sus datos y sus PDF; compartir una lista de la compra no da acceso a nada más.
