const XGPush = require('./node_modules/xinge-node-sdk')

const app =  new XGPush.XingeApp(2100323880, "AE4D74C6I8NM");
const message = new XGPush.AndroidMessage();
const s = new XGPush.Style();
const clickAction = new XGPush.ClickAction();


message.title = "Test"
message.content = "Test"
message.type = 1
message.style = s
message.action = clickAction
app.pushToAllDevices(message, (error, ret)=>{
    if(error){
        console.log(error)
    }
    console.log(ret)
})
console.log(app)