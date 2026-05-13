const dummyDeliveryData = [
  // 기존 코스 할당된 데이터
  { id: 1, course: "1", name: "킹스키즈-도곡", address1: "서울특별시 강남구 선릉로64길 15-13", address2: "", phone: "02-565-1605", boxCount: 1, memo: "2층 3층 중간계단 수배송", latitude: 37.4988744, longitude: 127.0530745, status: "pending" },
  { id: 2, course: "1", name: "주니어학원", address1: "서울특별시 강남구 도곡로 184", address2: "5층", phone: "02-3463-8747", boxCount: 2, memo: "5층 학원입구 앞", latitude: 37.4916885, longitude: 127.0397809, status: "pending" },
  { id: 3, course: "1", name: "아기사랑어린이집", address1: "서울특별시 강남구 도곡로 18길 35", address2: "도곡현대@3동 103호", phone: "02-571-3022", boxCount: 1, memo: "공동현관비밀번호 : / 문앞", latitude: 37.4893104, longitude: 127.0390241, status: "pending" },
  { id: 11, course: "2", name: "라온몬테소리어린이집", address1: "서울특별시 송파구 백제고분로22길 3-5", address2: "", phone: "02-417-7942", boxCount: 2, memo: "1층 입구 앞", latitude: 37.5034463, longitude: 127.0896975, status: "pending" },
  { id: 12, course: "2", name: "킹스키즈-대치", address1: "서울특별시 강남구 영동대로50길 14", address2: "", phone: "02-3453-3453", boxCount: 4, memo: "1층(2) / 2층(2) 별도 지정 장소", latitude: 37.4986674, longitude: 127.0703297, status: "pending" },
  
  // 미할당 데이터 (자동 라우팅 테스트용)
  { id: 101, course: null, name: "삼성어린이집", address1: "서울특별시 강남구 테헤란로 152", address2: "", phone: "02-123-4567", boxCount: 3, memo: "지하 주차장 하역장", latitude: 37.500593, longitude: 127.036365, status: "pending" },
  { id: 102, course: null, name: "대치유치원", address1: "서울특별시 강남구 남부순환로 2911", address2: "", phone: "02-987-6543", boxCount: 2, memo: "정문 경비실", latitude: 37.493548, longitude: 127.062060, status: "pending" },
  { id: 103, course: null, name: "송파아동센터", address1: "서울특별시 송파구 올림픽로 300", address2: "", phone: "02-555-1111", boxCount: 5, memo: "후문", latitude: 37.513261, longitude: 127.102566, status: "pending" },
  { id: 104, course: null, name: "역삼꿈나무", address1: "서울특별시 강남구 역삼로 123", address2: "", phone: "02-222-3333", boxCount: 1, memo: "문 앞", latitude: 37.494411, longitude: 127.030045, status: "pending" }
];

export default dummyDeliveryData;
