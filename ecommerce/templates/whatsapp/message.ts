export default () => {
  // Helper functions
  const randomId = () => Math.floor(Math.random() * 1000000000000000);
  const randomFromArray = (arr: any[]) =>
    arr[Math.floor(Math.random() * arr.length)];
  const randomPhone = () =>
    `${Math.floor(Math.random() * 1000000000)
      .toString()
      .padStart(10, "0")}`;
  const randomTimestamp = () =>
    Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 86400); // Random time in last 24 hours

  // Data arrays
  const customerNames = [
    "John Smith",
    "Maria Garcia",
    "James Johnson",
    "Sarah Wilson",
    "Michael Brown",
    "Emma Davis",
    "David Miller",
    "Lisa Anderson",
    "Robert Taylor",
    "Jennifer Martinez",
  ];

  const messageTypes = [
    "text",
    "image",
    "video",
    "document",
    "audio",
    "location",
  ];

  const messages = [
    "Hello! I need help with my order",
    "What are your store hours?",
    "Is this item still available?",
    "Can you help me track my package?",
    "I have a question about my order",
    "What's the status of my return?",
    "Do you ship internationally?",
    "Can I change my delivery address?",
    "Are there any current promotions?",
    "Thank you for your help!",
  ];

  const messageType = randomFromArray(messageTypes);
  const messageContent = { text: { body: randomFromArray(messages) } };

  return {
    headers: {
      "x-hub-signature": `U8JyYKUIIcMCwrd7adE0LhZbvnCt/zzTdHfkHkJ6Xns=`,
      "x-hub-signature-256": `U8JyYKUIIcMCwrd7adE0LhZbvnCt/zzTdHfkHkJ6Xns=`,
      "x-hookdeck-original-ip": randomFromArray([
        "2a03:2880:f2ff:c0:face:b00c:0:358",
        "2a03:2880:f1ff:c0:face:b00c:0:358",
        "2a03:2880:f0ff:c0:face:b00c:0:358",
        "31.13.92.52",
        "157.240.192.35",
      ]),
    },
    body: {
      object: "whatsapp_business_account",
      entry: [
        {
          id: `${randomId()}`,
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: randomPhone(),
                  phone_number_id: `${randomId()}`,
                },
                contacts: [
                  {
                    profile: {
                      name: randomFromArray(customerNames),
                    },
                    wa_id: randomPhone(),
                  },
                ],
                messages: [
                  {
                    from: randomPhone(),
                    id: `wamid.${randomId()}`,
                    timestamp: randomTimestamp(),
                    type: messageType,
                    ...messageContent,
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    },
  };
};
