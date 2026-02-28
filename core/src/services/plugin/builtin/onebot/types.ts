namespace Segment {
  export interface Text {
    type: "text";
    data: { text: string };
  }
  export interface Image {
    type: "image";
    data: {
      summary: string;
      file: string;
      sub_type: number;
      url: string;
      file_size: string;
    };
  }
  export interface Reply {
    type: "reply";
    data: {
      id: string;
    };
  }

  export type MessageSegment = Text | Image | Reply;
}

// Sender
interface Sender {
  user_id: number;
  nickname: string;
  card: string;
}

// Message
export interface Message {
  self_id: number;
  user_id: number;
  time: number;
  message_id: number;
  message_seq: number;
  real_id: number;
  real_seq: string;
  message_type: string;
  sender: Sender;
  raw_message: string;
  font: number;
  sub_type: string;
  message: Segment.MessageSegment[];
  message_format: string;
  post_type: string;
  group_id: number;
  group_name: string;
}

export interface ForwordMessageResponse {
  status: string;
  retcode: number;
  data: {
    messages: Message[];
  };
  message: string;
  wording: string;
  echo: null | string;
  stream: string;
}
