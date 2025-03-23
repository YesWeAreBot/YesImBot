import { describe, expect, test } from "bun:test";
import { h } from "koishi";
import { getFileUnique } from "../src/utils/toolkit";


describe("toolkit 工具函数测试套件", () => {
    describe("getFileUnique 文件唯一标识", () => {
        test("应生成 OneBot 平台文件标识", () => {
            const element = h.parse(`<img src="https://multimedia.nt.qq.com.cn/download?appid=1407&amp;fileid=EhQ2Zul6WkHnhgt7JAs54Jn-PTJqiRj_tAEg_woo75b-htWfjAMyBHByb2RQgL2jAVoQEwg3RDPza_VDZtYsKo2E_A&amp;rkey=CAISKIo-QUl4cCNy_UO5xEEqvdMvIbf4fK3ZrgOC7ExpouUFIbQV3U7M94Y" file="https://multimedia.nt.qq.com.cn/download?appid=1407&amp;fileid=EhQ2Zul6WkHnhgt7JAs54Jn-PTJqiRj_tAEg_woo75b-htWfjAMyBHByb2RQgL2jAVoQEwg3RDPza_VDZtYsKo2E_A&amp;rkey=CAISKIo-QUl4cCNy_UO5xEEqvdMvIbf4fK3ZrgOC7ExpouUFIbQV3U7M94Y" filename="7C0F2EFF615C29B7E4C2BD2532ED52DB.jpg" summary="[图片]" sub-type="0"/>`)[0];
            const result = getFileUnique(element, "onebot");
            expect(result).toMatch(/^[a-z0-9]{32}$/);
        });
    });
});