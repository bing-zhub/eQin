const XGPush = require('./node_modules/xinge-node-sdk')

const app =  new XGPush.XingeApp(2100323880, "AE4D74C6I8NM");
const message = new XGPush.AndroidMessage();
const style = new XGPush.Style();
const clickAction = new XGPush.ClickAction();


function pushToDevice(title, content){
    message.title = title
    message.content = content
    message.type = 1
    message.style = style
    message.action = clickAction
    app.pushToAllDevices(message, (error, ret)=>{
        if(error){
            console.log(new Date()+ " "+error)
        }
        ret =  JSON.parse(ret)
        if(ret.ret_code === 0){
            console.log(new Date()+" 推送成功")
        }
    })
}

module.exports = {
    pushToDevice
}

