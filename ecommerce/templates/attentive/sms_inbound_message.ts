export default () => {
  // Helper functions
  const randomId = () => Math.floor(Math.random() * 1000000000000000);
  const randomFromArray = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)];
  const randomPhone = () => `+1${Math.floor(Math.random() * 1000000000).toString().padStart(10, '0')}`;
  const randomDate = () => new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).getTime();

  // Data arrays
  const companies = [
    { display_name: 'Attentive', company_id: 'MDc6Q29tcGFueTIyNzM' },
    { display_name: 'Fashion Co', company_id: 'MDc6Q29tcGFueTIyNzQ' },
    { display_name: 'Style Hub', company_id: 'MDc6Q29tcGFueTIyNzU' },
    { display_name: 'Trendy Store', company_id: 'MDc6Q29tcGFueTIyNzY' }
  ];

  const messages = [
    'Hello!',
    'I need help with my order',
    'STOP',
    'What are your store hours?',
    'Is this item in stock?',
    'When will my order arrive?',
    'Thanks for your help!',
    'HELP',
    'Can you check my order status?'
  ];

  const externalIds = {
    klaviyo_id: Array(Math.floor(Math.random() * 3) + 1).fill(null).map(() => Math.floor(Math.random() * 10000).toString()),
    shopify_id: Array(Math.floor(Math.random() * 3) + 1).fill(null).map(() => Math.floor(Math.random() * 10000).toString()),
    client_user_id: Array(Math.floor(Math.random() * 3) + 1).fill(null).map(() => Math.floor(Math.random() * 10000).toString()),
    custom_identifiers: {
      test_custom_id: Array(Math.floor(Math.random() * 3) + 1).fill(null).map(() => Math.floor(Math.random() * 10000).toString())
    }
  };

  return {
    headers: {
      "x-attentive-hmac-sha256": "U8JyYKUIIcMCwrd7adE0LhZbvnCt/zzTdHfkHkJ6Xns=",
    },
    body: {
      type: "sms.inbound_message",
      timestamp: randomDate(),
      company: randomFromArray(companies),
      subscriber: {
        phone: randomPhone(),
        external_id: randomId(),
        external_identifiers: externalIds
      },
      message: {
        type: 'TYPE_CONVERSATION',
        text: randomFromArray(messages),
        to_phone: randomPhone()
      },
    },
  };
};
