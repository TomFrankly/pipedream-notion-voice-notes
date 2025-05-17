// Create a large object
const largeResponse = {
    data: {
        items: Array(1000000).fill({ 
            id: 1,
            name: "test",
            details: {
                description: "test description",
                metadata: {
                    timestamp: Date.now(),
                    version: "1.0"
                }
            }
        })
    }
};

// Access a nested property
const timestamp = largeResponse.data.items[0].details.metadata.timestamp;

// The entire largeResponse object remains in memory
// because we still have a reference to it through the timestamp variable

// To free up memory, you would need to:
// 1. Remove all references to the object
// 2. Let the garbage collector clean it up
largeResponse = null; 