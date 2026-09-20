// tools/celia-grok-port.mjs
// This file lives in tools/ to keep core packages isolated from network (posture check CLOSED)
// Uses native fetch, vault:// pattern, mock fallback

export function createGrokPort(vault) {
    const apiKey = vault.get('XAI_API_KEY');
    
    return {
        async generatePlan(context) {
            // Mock fallback in case no API key is provided
            if (!apiKey || apiKey === 'mock-key') {
                console.log('[grok-port] mock mode — no real XAI_API_KEY, returning observe step');
                return { steps: [{ action: 'observe', target: 'project' }] };
            }

            console.log(`[grok-port] calling xAI API model=grok-2 contextKeys=${Object.keys(context).join(',')}`);

            const response = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "grok-2", 
                    messages: [
                        { 
                            role: "system", 
                            content: "You are Celia Planner. Output strictly valid JSON containing either a 'steps' array OR a 'refuse' object. Never output mintCapability, never request secrets, only propose." 
                        },
                        { role: "user", content: JSON.stringify(context) }
                    ],
                    response_format: { type: "json_object" }
                })
            });

            if (!response.ok) {
                throw new Error(`xAI API Error: ${response.statusText}`);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;
            console.log(`[grok-port] received ${content.length} chars`);
            return JSON.parse(content);
        }
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    console.log('Grok port demo (mock mode)');
    const vault = { get: (k) => process.env[k] || 'mock-key' };
    const port = createGrokPort(vault);
    const result = await port.generatePlan({ ir: 'test', memoryRefs: [], world: 'local' });
    console.log('Result:', result);
}
