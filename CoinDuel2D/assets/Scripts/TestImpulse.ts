import { _decorator, Component, RigidBody2D, Vec2 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('TestImpulse')
export class TestImpulse extends Component {
    start() {
        // 延迟 0.5 秒后，给硬币一个向右的推力
        this.scheduleOnce(() => {
            const rb = this.getComponent(RigidBody2D);
            if (rb) {
                // 给一个冲量，模拟弹射效果
                const center = new Vec2();
                rb.getWorldCenter(center);
                rb.applyLinearImpulse(new Vec2(50, 20), center, true);
                console.log("测试推力已施加");
            }
        }, 0.5);
    }
}