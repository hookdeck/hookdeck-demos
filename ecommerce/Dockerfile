FROM oven/bun:1.3.3

WORKDIR /app

COPY package.json ./
COPY index.ts tsconfig.json ./
COPY templates ./templates
COPY traffic/shopify-delivery-groups.ts ./traffic/shopify-delivery-groups.ts

CMD ["bun", "run", "start"]
