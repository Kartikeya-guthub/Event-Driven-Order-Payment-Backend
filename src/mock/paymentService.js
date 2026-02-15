async function processPayment({orderId, amount}){
    console.log(`Processing payment for order ${orderId} with amount ${amount}`);

    await sleep(1000);
    
    // Simulate random failures for retry/DLQ testing
    const success = Math.random() > 0.3;

    if(success){
        return{status: "SUCCESS"};
    }else{
        return{status: "FAILED"};
    }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { processPayment };