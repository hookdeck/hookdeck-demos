export default () => {
  const randomId = () => Math.floor(Math.random() * 1000000);
  const randomFromArray = (arr: any[]) =>
    arr[Math.floor(Math.random() * arr.length)];
  const randomDate = () =>
    Math.floor(Date.now() / 1000 - Math.random() * 90 * 24 * 60 * 60);

  const storeIds = ["1002853587", "1002853588", "1002853589", "1002853590"];
  const producers = [
    "stores/leo8j9o1ip",
    "stores/abc123xyz",
    "stores/def456uvw",
    "stores/ghi789rst",
  ];

  return {
    headers: {
      "webhook-id": String(randomId()),
      "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    },
    body: {
      producer: randomFromArray(producers),
      hash: "U8JyYKUIIcMCwrd7adE0LhZbvnCt/zzTdHfkHkJ6Xns=",
      created_at: randomDate(),
      store_id: randomFromArray(storeIds),
      scope: "store/product/created",
      data: {
        type: "product",
        id: randomId(),
      },
    },
  };
};
