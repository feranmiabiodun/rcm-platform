# Use a small Python base
FROM python:3.11-slim

# set working directory
WORKDIR /app

# Prevent creation of .pyc files
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# system deps (if you need build tools uncomment)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
 && rm -rf /var/lib/apt/lists/*

# copy requirements first for cache efficiency
COPY requirements.txt .

# install python deps
RUN pip install --no-cache-dir -r requirements.txt

# copy app code
COPY . .

# expose port used by your app
EXPOSE 8000

# default command — change "main:app" if your app object is named differently
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--loop", "auto", "--lifespan", "on"]


