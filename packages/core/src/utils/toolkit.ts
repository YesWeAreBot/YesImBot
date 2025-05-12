import { isEmpty } from "./string";


/**
 * 消息内容是否包含过滤词
 * @param content
 * @param FilterList
 * @returns
 */
export function containsFilter(content: string, FilterList: string[]): boolean {
    for (const filter of FilterList) {
        if (isEmpty(filter)) continue;
        let regex = new RegExp(filter, "gi");
        if (regex.test(content))
            return true;
    }
    return false;
}

export function formatDate(date: Date, format: string = "YYYY-MM-DD HH:mm:ss") {
    const pad = (num) => String(num).padStart(2, '0');
    date.toLocaleString
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    return format
        .replace(/YYYY/g, year.toString())
        .replace(/YY/g, String(year).slice(-2))
        .replace(/MM/g, pad(month))
        .replace(/M/g, month.toString())
        .replace(/DD/g, pad(day))
        .replace(/D/g, day.toString())
        .replace(/HH/g, pad(hours))
        .replace(/H/g, hours.toString())
        .replace(/mm/g, pad(minutes))
        .replace(/m/g, minutes.toString())
        .replace(/ss/g, pad(seconds))
        .replace(/s/g, seconds.toString());
}


/**
 * 获取频道类型
 */
export function getChannelType(channelId: string): 'private' | 'guild' | 'sandbox' {
    if (channelId.startsWith('private:')) {
        return 'private';
    } else if (channelId === '#') {
        return 'sandbox';
    } else {
        return 'guild';
    }
}