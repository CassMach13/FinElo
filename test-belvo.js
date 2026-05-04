const fetch = require('node-fetch');

async function test() {
    const secretId = "aea41230-c1d9-4948-9c43-f2c9460b7af2";
    const secretPassword = "3WYHHNpkRrExoykH-Lh@eyA_6V8agbg8HzFoNCOKTtjXmuy*sYEvhTZMUV6cIa5i";
    
    const credentials = Buffer.from(`${secretId}:${secretPassword}`).toString('base64');
    
    const body = {
        id: secretId,
        password: secretPassword,
        scopes: "read_institutions,write_links,read_accounts,read_transactions,read_owners"
    };

    console.log("Sending body:", JSON.stringify(body));

    const response = await fetch('https://sandbox.belvo.com/api/token/', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
    });
    
    const text = await response.text();
    console.log("Status:", response.status);
    console.log("Response:", text);
}

test();
