# 1. Usar una imagen ligera de Node.js 20
FROM node:20-slim

# 2. Establecer el directorio de trabajo dentro del contenedor
WORKDIR /app

# 3. Copiar solo los archivos de dependencias primero (para aprovechar la caché de Docker)
COPY package*.json ./
COPY tsconfig*.json ./

# 4. Instalar dependencias
RUN npm install

# 5. Copiar el resto del código fuente
COPY . .

# 6. Compilar el frontend (esto crea la carpeta 'dist')
RUN npm run build

# 7. Forzar el entorno de producción para que sirva la carpeta 'dist'
ENV NODE_ENV=production

# 8. Google Cloud Run inyecta el puerto aquí (usualmente 8080)
ENV PORT=8080

# 9. Comando para iniciar el servidor
CMD ["npm", "start"]